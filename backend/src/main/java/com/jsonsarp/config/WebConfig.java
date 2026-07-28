package com.jsonsarp.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig {

    /**
     * Tarayicidan dogrudan cagrilacak on yuz adresleri.
     *
     * On yuz Vercel/Cloudflare uzerinden rewrite ile geliyorsa istek sunucu-sunucu
     * oldugu icin burasi hic devreye girmez; liste yalnizca backend'e baska bir
     * alan adindan dogrudan gidildiginde gerekir.
     */
    @Value("${jsonsarp.cors.allowed-origins:*}")
    private String[] allowedOrigins;

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                        .allowedOriginPatterns(allowedOrigins)
                        .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
                        .allowedHeaders("*");
            }
        };
    }
}
