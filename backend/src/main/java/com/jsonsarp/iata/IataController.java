package com.jsonsarp.iata;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/iata")
public class IataController {

    private final XsdSchemaService schemaService;
    private final JsonAnnotator annotator;

    public IataController(XsdSchemaService schemaService, JsonAnnotator annotator) {
        this.schemaService = schemaService;
        this.annotator = annotator;
    }

    @GetMapping("/messages")
    public MessagesResponse messages() {
        return new MessagesResponse(schemaService.listMessages());
    }

    @PostMapping("/annotate")
    public AnnotateResponse annotate(@RequestBody AnnotateRequest request) {
        return annotator.annotate(request.json());
    }
}
