package com.jsonsarp.iata;

import org.apache.ws.commons.schema.XmlSchema;
import org.apache.ws.commons.schema.XmlSchemaAll;
import org.apache.ws.commons.schema.XmlSchemaAllMember;
import org.apache.ws.commons.schema.XmlSchemaAnnotated;
import org.apache.ws.commons.schema.XmlSchemaAnnotation;
import org.apache.ws.commons.schema.XmlSchemaAnnotationItem;
import org.apache.ws.commons.schema.XmlSchemaAttribute;
import org.apache.ws.commons.schema.XmlSchemaAttributeGroup;
import org.apache.ws.commons.schema.XmlSchemaAttributeGroupMember;
import org.apache.ws.commons.schema.XmlSchemaAttributeGroupRef;
import org.apache.ws.commons.schema.XmlSchemaAttributeOrGroupRef;
import org.apache.ws.commons.schema.XmlSchemaChoice;
import org.apache.ws.commons.schema.XmlSchemaChoiceMember;
import org.apache.ws.commons.schema.XmlSchemaCollection;
import org.apache.ws.commons.schema.XmlSchemaComplexContent;
import org.apache.ws.commons.schema.XmlSchemaComplexContentExtension;
import org.apache.ws.commons.schema.XmlSchemaComplexType;
import org.apache.ws.commons.schema.XmlSchemaContentModel;
import org.apache.ws.commons.schema.XmlSchemaDocumentation;
import org.apache.ws.commons.schema.XmlSchemaElement;
import org.apache.ws.commons.schema.XmlSchemaParticle;
import org.apache.ws.commons.schema.XmlSchemaSequence;
import org.apache.ws.commons.schema.XmlSchemaSequenceMember;
import org.apache.ws.commons.schema.XmlSchemaSimpleContent;
import org.apache.ws.commons.schema.XmlSchemaSimpleContentExtension;
import org.apache.ws.commons.schema.XmlSchemaType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.namespace.QName;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * IATA XSD dosyalarini tip bazli bir indekse cevirir.
 *
 * <p>Indeks "yol -> aciklama" degil "tip -> cocuklari" seklindedir. Boylece NDC'de
 * yogun sekilde yeniden kullanilan tipler (TypeCode, RefID, Text ...) her baglamda
 * kendi aciklamasini verir; duz yol haritasinda bu alanlar birbirinin aciklamasini
 * gosteriyordu.
 */
@Service
public class XsdSchemaService {

    private static final Logger log = LoggerFactory.getLogger(XsdSchemaService.class);

    /** Indeksleme sirasinda dongu korumasi icin gecici olarak konan isaret. */
    private static final TypeInfo IN_PROGRESS = new TypeInfo("", "", Map.of());

    private final Map<String, MessageInfo> messages = new LinkedHashMap<>();
    private final Map<String, TypeInfo> types = new HashMap<>();
    private XmlSchemaCollection schemaCollection;

    @Value("${jsonsarp.xsd.path:}")
    private String xsdPath;

    @PostConstruct
    public void loadSchemas() {
        schemaCollection = new XmlSchemaCollection();
        // xs:import ile cekilen semalar da DOCTYPE'sindan arindirilarak okunmali;
        // aksi halde koleksiyon kendi cozumleyicisini kullanip ayni DTD hatasina duser.
        schemaCollection.setSchemaResolver(this::resolveImportedSchema);
        int loaded = loadFromDirectories();
        if (loaded == 0) {
            loaded = loadFromClasspathPattern();
        }
        if (schemaCollection.getXmlSchemas().length == 0) {
            log.warn("XSD yuklenemedi. backend/src/main/resources/xsd/ klasorunu kontrol edin.");
            return;
        }
        indexMessages();
        log.info("{} XSD dosyasi yuklendi, {} mesaj ve {} tip indekslendi",
                loaded, messages.size(), types.size());
    }

    public boolean isSchemaLoaded() {
        return !messages.isEmpty();
    }

    public MessageInfo getMessage(String messageType) {
        return messages.get(messageType);
    }

    public boolean hasMessage(String messageType) {
        return messages.containsKey(messageType);
    }

    public List<String> listMessages() {
        return new ArrayList<>(messages.keySet());
    }

    public TypeInfo getType(String typeKey) {
        return typeKey == null ? null : types.get(typeKey);
    }

    /** Mesajin govdesinde dogrudan yer alan eleman adlari; mesaj tipi tespitinde kullanilir. */
    public Set<String> getTopLevelElements(String messageType) {
        MessageInfo message = messages.get(messageType);
        if (message == null) {
            return Set.of();
        }
        TypeInfo root = types.get(message.rootTypeKey());
        return root == null ? Set.of() : root.children().keySet();
    }

    // --- XSD yukleme ---------------------------------------------------------

    private int loadFromDirectories() {
        for (Path dir : resolveXsdDirectories()) {
            int count = loadDirectory(dir);
            if (count > 0) {
                log.info("XSD dizini: {} ({} dosya)", dir, count);
                return count;
            }
        }
        return 0;
    }

    private List<Path> resolveXsdDirectories() {
        List<Path> dirs = new ArrayList<>();
        try {
            Resource cp = new ClassPathResource("xsd");
            if (cp.exists() && cp.isFile()) {
                dirs.add(cp.getFile().toPath().toAbsolutePath().normalize());
            }
        } catch (IOException e) {
            log.debug("Classpath xsd dizini dosya olarak acilamadi: {}", e.getMessage());
        }

        if (xsdPath != null && !xsdPath.isBlank()) {
            dirs.add(Path.of(xsdPath).toAbsolutePath().normalize());
        }
        dirs.add(Path.of("src/main/resources/xsd").toAbsolutePath().normalize());
        dirs.add(Path.of("backend/src/main/resources/xsd").toAbsolutePath().normalize());
        return dirs;
    }

    private int loadDirectory(Path dir) {
        if (!Files.isDirectory(dir)) {
            return 0;
        }
        int count = 0;
        try (Stream<Path> walk = Files.walk(dir)) {
            List<Path> files = walk
                    .filter(p -> p.toString().toLowerCase().endsWith(".xsd"))
                    // Ortak tipler once yuklenmeli: bir mesaj dosyasi okunurken import
                    // edilen sema koleksiyonda yoksa kendi cozumleyicisiyle okunur ve
                    // bizim guvenli ayristiricimizi atlar.
                    .sorted(Comparator
                            .comparingInt(XsdSchemaService::loadPriority)
                            .thenComparing(Path::toString))
                    .toList();
            for (Path file : files) {
                try {
                    readXsdFile(file);
                    count++;
                } catch (Exception e) {
                    log.warn("XSD atlandi {}: {}", file.getFileName(), e.getMessage());
                }
            }
        } catch (IOException e) {
            log.warn("XSD dizini okunamadi {}: {}", dir, e.getMessage());
        }
        return count;
    }

    private int loadFromClasspathPattern() {
        int count = 0;
        try {
            Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources("classpath:xsd/**/*.xsd");
            for (Resource resource : resources) {
                try (InputStream in = resource.getInputStream()) {
                    readXsdStream(in, resource.getURI().toString());
                    count++;
                } catch (Exception e) {
                    log.warn("Classpath XSD atlandi {}: {}", resource.getFilename(), e.getMessage());
                }
            }
        } catch (IOException e) {
            log.warn("Classpath XSD taranamadi: {}", e.getMessage());
        }
        return count;
    }

    /** Dosya adina gore yukleme onceligi; kucuk deger once yuklenir. */
    private static int loadPriority(Path file) {
        String name = file.getFileName().toString().toLowerCase();
        if (name.startsWith("xmldsig")) {
            return 0;
        }
        return name.contains("commontypes") ? 1 : 2;
    }

    private void readXsdFile(Path xsdFile) throws Exception {
        try (InputStream in = Files.newInputStream(xsdFile)) {
            // Goreli xs:import yollarinin cozulebilmesi icin systemId sart.
            readXsdStream(in, xsdFile.toUri().toString());
        }
    }

    private void readXsdStream(InputStream inputStream, String systemId) throws Exception {
        String xml = stripDoctype(new String(inputStream.readAllBytes(), StandardCharsets.UTF_8));
        InputSource input = new InputSource(new StringReader(xml));
        input.setSystemId(systemId);
        schemaCollection.read(newDocumentBuilder().parse(input), systemId);
    }

    /** xs:import hedeflerini DOCTYPE'siz olarak sunar. */
    private InputSource resolveImportedSchema(String namespace, String schemaLocation, String baseUri) {
        if (schemaLocation == null || baseUri == null) {
            return null;
        }
        try {
            URI resolved = URI.create(baseUri).resolve(schemaLocation);
            String xml = stripDoctype(Files.readString(Path.of(resolved), StandardCharsets.UTF_8));
            InputSource source = new InputSource(new StringReader(xml));
            source.setSystemId(resolved.toString());
            return source;
        } catch (Exception e) {
            log.debug("Import cozumlenemedi {} ({}): {}", schemaLocation, baseUri, e.getMessage());
            return null;
        }
    }

    /**
     * DOCTYPE bildirimini (varsa ic alt kumesiyle birlikte) kaldirir.
     *
     * <p>xmldsig-core-schema.xsd, W3C'nin uzak XMLSchema.dtd dosyasina isaret eden bir
     * DOCTYPE tasir. Ayristirici bunu indirmeye calisip guvenlik kisiti nedeniyle
     * basarisiz oluyor ve dosyayi dusuruyordu; onu import eden
     * IATA_OffersAndOrdersCommonTypes.xsd dahil butun ortak tip dosyalari da birlikte
     * dusuyordu. XSD'ler DTD dogrulamasina ihtiyac duymaz.
     */
    private static String stripDoctype(String xml) {
        int start = xml.indexOf("<!DOCTYPE");
        if (start < 0) {
            return xml;
        }
        int internalSubset = xml.indexOf("]>", start);
        int end = internalSubset >= 0 ? internalSubset + 2 : xml.indexOf('>', start) + 1;
        if (end <= start) {
            return xml;
        }
        return xml.substring(0, start) + xml.substring(end);
    }

    /**
     * DTD cozumlemesi kapali bir ayristirici.
     *
     * <p>xmldsig-core-schema.xsd, W3C'nin uzak XMLSchema.dtd dosyasina isaret eden bir
     * DOCTYPE tasir. Varsayilan ayristirici bunu indirmeye calisip guvenlik kisiti
     * nedeniyle basarisiz oluyor ve dosyayi dusuruyordu; bu dosyayi import eden
     * IATA_OffersAndOrdersCommonTypes.xsd dahil butun ortak tip dosyalari da onunla
     * birlikte dusuyordu. XSD'ler DTD dogrulamasina ihtiyac duymaz, bu yuzden DTD'yi
     * hic yuklemiyoruz.
     */
    private DocumentBuilder newDocumentBuilder() throws ParserConfigurationException {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setValidating(false);
        setFeatureQuietly(factory, "http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        setFeatureQuietly(factory, "http://xml.org/sax/features/external-general-entities", false);
        setFeatureQuietly(factory, "http://xml.org/sax/features/external-parameter-entities", false);

        DocumentBuilder builder = factory.newDocumentBuilder();
        // Ayristirici yine de bir harici varlik isterse bos icerik ver.
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        return builder;
    }

    private static void setFeatureQuietly(DocumentBuilderFactory factory, String feature, boolean value) {
        try {
            factory.setFeature(feature, value);
        } catch (ParserConfigurationException e) {
            log.debug("XML ayristirici ozelligi desteklenmiyor {}: {}", feature, e.getMessage());
        }
    }

    // --- Indeksleme ----------------------------------------------------------

    private void indexMessages() {
        for (XmlSchema schema : schemaCollection.getXmlSchemas()) {
            Map<QName, XmlSchemaElement> elements = schema.getElements();
            if (elements == null) {
                continue;
            }
            for (XmlSchemaElement element : elements.values()) {
                String name = element.getName();
                if (name == null || !isMessageElement(name) || messages.containsKey(name)) {
                    continue;
                }
                String rootTypeKey = registerType(resolveType(element), "element:" + name);
                messages.put(name, new MessageInfo(name, rootTypeKey, extractDocumentation(element)));
            }
        }
    }

    /**
     * Gercek mesaj kokleri IATA_ onekiyle baslar. Onceki surumdeki "Payment" oneki
     * ortak tip dosyasindaki 40 siradan elemani (PaymentCard, PaymentMethod ...)
     * mesaj sanip hem mesaj listesini hem tip tespitini bozuyordu.
     */
    private boolean isMessageElement(String name) {
        return name.startsWith("IATA_");
    }

    /**
     * Tipi indekse ekler ve anahtarini dondurur. Her tip yalnizca bir kez islenir;
     * ozyinelemeli tipler IN_PROGRESS isaretiyle korunur.
     *
     * @param syntheticKey adsiz (inline) tipler icin kullanilacak benzersiz anahtar
     */
    private String registerType(XmlSchemaType type, String syntheticKey) {
        if (!(type instanceof XmlSchemaComplexType complexType)) {
            return null;
        }

        QName qName = complexType.getQName();
        String key = qName != null ? qName.toString() : syntheticKey;
        if (types.containsKey(key)) {
            return key;
        }
        types.put(key, IN_PROGRESS);

        Map<String, ElementInfo> children = new LinkedHashMap<>();
        collectChildren(complexType, children, key);

        String displayName = qName != null ? qName.getLocalPart() : "(inline)";
        types.put(key, new TypeInfo(key, displayName, children));
        return key;
    }

    private void collectChildren(XmlSchemaComplexType complexType, Map<String, ElementInfo> children, String ownerKey) {
        XmlSchemaContentModel contentModel = complexType.getContentModel();
        if (contentModel instanceof XmlSchemaComplexContent complexContent
                && complexContent.getContent() instanceof XmlSchemaComplexContentExtension extension) {
            // Once temel tipin cocuklari, sonra genisletme: alt tip ayni adi ezebilsin.
            if (resolveTypeByName(extension.getBaseTypeName()) instanceof XmlSchemaComplexType base) {
                collectChildren(base, children, ownerKey);
            }
            collectParticle(extension.getParticle(), children, ownerKey);
            collectAttributes(extension.getAttributes(), children);
        } else if (contentModel instanceof XmlSchemaSimpleContent simpleContent
                && simpleContent.getContent() instanceof XmlSchemaSimpleContentExtension extension) {
            collectAttributes(extension.getAttributes(), children);
        }

        collectParticle(complexType.getParticle(), children, ownerKey);
        collectAttributes(complexType.getAttributes(), children);
    }

    private void collectParticle(XmlSchemaParticle particle, Map<String, ElementInfo> children, String ownerKey) {
        if (particle instanceof XmlSchemaSequence sequence) {
            for (XmlSchemaSequenceMember member : sequence.getItems()) {
                collectMember(member, children, ownerKey);
            }
        } else if (particle instanceof XmlSchemaChoice choice) {
            for (XmlSchemaChoiceMember member : choice.getItems()) {
                collectMember(member, children, ownerKey);
            }
        } else if (particle instanceof XmlSchemaAll all) {
            for (XmlSchemaAllMember member : all.getItems()) {
                collectMember(member, children, ownerKey);
            }
        }
    }

    private void collectMember(Object member, Map<String, ElementInfo> children, String ownerKey) {
        if (member instanceof XmlSchemaElement element) {
            collectElement(element, children, ownerKey);
        } else if (member instanceof XmlSchemaParticle nested) {
            collectParticle(nested, children, ownerKey);
        }
    }

    private void collectElement(XmlSchemaElement element, Map<String, ElementInfo> children, String ownerKey) {
        String name = element.getName();
        if (name == null) {
            // element ref="..." — hedefin adini kullan.
            QName ref = element.getRef() != null ? element.getRef().getTargetQName() : null;
            if (ref == null) {
                return;
            }
            name = ref.getLocalPart();
        }
        if (children.containsKey(name)) {
            return;
        }

        XmlSchemaType type = resolveType(element);
        String childKey = registerType(type, ownerKey + "/" + name);
        children.put(name, new ElementInfo(
                name,
                typeDisplayName(element, type),
                childKey,
                extractDocumentation(element),
                false));
    }

    private void collectAttributes(List<XmlSchemaAttributeOrGroupRef> attributes, Map<String, ElementInfo> children) {
        if (attributes == null) {
            return;
        }
        for (XmlSchemaAttributeOrGroupRef item : attributes) {
            if (item instanceof XmlSchemaAttribute attribute) {
                addAttribute(attribute, children);
            } else if (item instanceof XmlSchemaAttributeGroupRef groupRef && groupRef.getRef() != null) {
                XmlSchemaAttributeGroup group = groupRef.getRef().getTarget();
                if (group == null) {
                    continue;
                }
                for (XmlSchemaAttributeGroupMember member : group.getAttributes()) {
                    if (member instanceof XmlSchemaAttribute attribute) {
                        addAttribute(attribute, children);
                    }
                }
            }
        }
    }

    private void addAttribute(XmlSchemaAttribute attribute, Map<String, ElementInfo> children) {
        String name = attribute.getName();
        if (name == null || children.containsKey(name)) {
            return;
        }
        QName typeName = attribute.getSchemaTypeName();
        children.put(name, new ElementInfo(
                name,
                typeName != null ? typeName.getLocalPart() : null,
                null,
                extractDocumentation(attribute),
                true));
    }

    private String typeDisplayName(XmlSchemaElement element, XmlSchemaType type) {
        QName declared = element.getSchemaTypeName();
        if (declared != null) {
            return declared.getLocalPart();
        }
        if (type != null && type.getQName() != null) {
            return type.getQName().getLocalPart();
        }
        return null;
    }

    private XmlSchemaType resolveType(XmlSchemaElement element) {
        XmlSchemaType type = element.getSchemaType();
        if (type != null) {
            return type;
        }
        XmlSchemaType byName = resolveTypeByName(element.getSchemaTypeName());
        if (byName != null) {
            return byName;
        }
        // element ref="..." durumunda tip hedef elemanda tanimlidir.
        if (element.getRef() != null && element.getRef().getTarget() != null) {
            XmlSchemaElement target = element.getRef().getTarget();
            return target.getSchemaType() != null
                    ? target.getSchemaType()
                    : resolveTypeByName(target.getSchemaTypeName());
        }
        return null;
    }

    private XmlSchemaType resolveTypeByName(QName typeName) {
        if (typeName == null) {
            return null;
        }
        XmlSchemaType global = schemaCollection.getTypeByQName(typeName);
        if (global != null) {
            return global;
        }
        for (XmlSchema other : schemaCollection.getXmlSchemas()) {
            XmlSchemaType found = other.getTypeByName(typeName);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    private String extractDocumentation(XmlSchemaAnnotated annotated) {
        if (annotated == null || annotated.getAnnotation() == null) {
            return null;
        }
        XmlSchemaAnnotation annotation = annotated.getAnnotation();
        StringBuilder sb = new StringBuilder();
        for (XmlSchemaAnnotationItem item : annotation.getItems()) {
            if (item instanceof XmlSchemaDocumentation documentation) {
                String content = extractDocumentationText(documentation);
                if (content != null && !content.isBlank()) {
                    if (!sb.isEmpty()) {
                        sb.append(' ');
                    }
                    sb.append(content.trim());
                }
            }
        }
        return sb.isEmpty() ? null : sb.toString();
    }

    private String extractDocumentationText(XmlSchemaDocumentation documentation) {
        NodeList markup = documentation.getMarkup();
        if (markup == null || markup.getLength() == 0) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < markup.getLength(); i++) {
            if (markup.item(i) != null) {
                sb.append(markup.item(i).getTextContent());
            }
        }
        String text = sb.toString().trim();
        return text.isEmpty() ? null : text;
    }
}
