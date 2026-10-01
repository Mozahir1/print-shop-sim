package com.printshop.server;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

// Lets the browser game (a different origin) call the API.
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${app.cors-origins}")
    private String[] corsOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(corsOrigins)
                .allowedMethods("GET", "POST");
    }
}
