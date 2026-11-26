idf_component_register(
    SRCS "main.cpp" "lighting.cpp" "device_client.cpp"
    INCLUDE_DIRS "."
    PRIV_REQUIRES esp_driver_gpio esp_driver_uart esp_driver_rmt esp_adc esp_timer freertos log
        esp_wifi esp_event esp_netif nvs_flash esp_http_client mbedtls json esp_hw_support
)
