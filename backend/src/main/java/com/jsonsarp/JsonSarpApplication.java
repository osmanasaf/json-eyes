package com.jsonsarp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Zamanlama, saklama suresi dolan paylasimlari temizleyen gorev icin acik. */
@EnableScheduling
@SpringBootApplication
public class JsonSarpApplication {

    public static void main(String[] args) {
        SpringApplication.run(JsonSarpApplication.class, args);
    }
}
