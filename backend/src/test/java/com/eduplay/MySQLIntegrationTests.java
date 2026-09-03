package com.eduplay;

import com.eduplay.game.ActivationCode;
import com.eduplay.game.ActivationCodeRepository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("mysql")
@EnabledIfEnvironmentVariable(named = "MYSQL_TEST", matches = "true")
class MySQLIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JsonMapper jsonMapper;

    @Autowired
    private ActivationCodeRepository activationCodeRepository;

    @Test
    void mysqlCanRunAuthStoreAndInstallFlow() throws Exception {
        String username = "mysql_" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult registerResult = mockMvc.perform(post("/api/v1/auth/local/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username
                                + "\",\"password\":\"123456\",\"nickname\":\"MySQL测试\"}"))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode registerJson = jsonMapper.readTree(
                registerResult.getResponse().getContentAsString()
        );
        String token = registerJson.path("data").path("token").asText();

        String codeValue = "MYSQL-" + UUID.randomUUID().toString().substring(0, 12).toUpperCase();
        ActivationCode activationCode = new ActivationCode();
        activationCode.setGameCode("province_puzzle");
        activationCode.setCode(codeValue);
        activationCode.setStatus("UNUSED");
        activationCode.setCreatedAt(Instant.now());
        activationCodeRepository.save(activationCode);

        mockMvc.perform(post("/api/v1/store/redeem")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + codeValue + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.gameCode").value("province_puzzle"));

        mockMvc.perform(post("/api/v1/store/games/province_puzzle/install")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.owned").value(true))
                .andExpect(jsonPath("$.data.installed").value(true));

        mockMvc.perform(get("/api/v1/store/games")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].gameCode").value("province_puzzle"))
                .andExpect(jsonPath("$.data[0].installed").value(true));
    }
}
