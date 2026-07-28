# --- derleme ---------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Bagimliliklar once cekilir; kaynak degistiginde bu katman onbellekten gelir.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q clean package -DskipTests

# --- calisma ---------------------------------------------------------------
FROM eclipse-temurin:21-jre
WORKDIR /app

COPY --from=build /build/target/json-sarp-backend-*.jar app.jar

# H2 dosya veritabani buraya yazilir; kalici olmasi icin volume baglanmali,
# yoksa her yeniden dagitimda paylasimlar ve yorumlar silinir.
VOLUME ["/app/data"]
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
