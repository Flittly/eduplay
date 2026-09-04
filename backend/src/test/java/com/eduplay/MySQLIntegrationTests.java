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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("cloud")
@EnabledIfEnvironmentVariable(named = "MYSQL_TEST", matches = "true")
class MySQLIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JsonMapper jsonMapper;

    @Autowired
    private ActivationCodeRepository activationCodeRepository;

    @Test
    void cloudProfileCanRunAuthGameAndRedeemFlow() throws Exception {
        String username = "mysql_" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult registerResult = mockMvc.perform(post("/api/v1/auth/local/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username
                                + "\",\"password\":\"123456\",\"nickname\":\"云端测试\"}"))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode registerJson = jsonMapper.readTree(
                registerResult.getResponse().getContentAsString()
        );
        String token = registerJson.path("data").path("token").asText();

        MvcResult adminLoginResult = mockMvc.perform(post("/api/v1/admin/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn();
        String adminToken = jsonMapper.readTree(
                adminLoginResult.getResponse().getContentAsString()
        ).path("data").path("token").asText();

        String gameCode = "cloud_game_" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult createGameResult = mockMvc.perform(post("/api/v1/admin/games")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"gameCode\":\"" + gameCode
                                + "\",\"name\":\"云端测试游戏\",\"priceCents\":990}"))
                .andExpect(status().isOk())
                .andReturn();
        long gameId = jsonMapper.readTree(
                createGameResult.getResponse().getContentAsString()
        ).path("data").path("id").asLong();

        mockMvc.perform(patch("/api/v1/admin/games/" + gameId + "/status")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk());

        String codeValue = "CLOUD-" + UUID.randomUUID().toString().substring(0, 12).toUpperCase();
        ActivationCode activationCode = new ActivationCode();
        activationCode.setGameCode(gameCode);
        activationCode.setCode(codeValue);
        activationCode.setStatus("UNUSED");
        activationCode.setCreatedAt(Instant.now());
        activationCodeRepository.save(activationCode);

        mockMvc.perform(post("/api/v1/store/redeem")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + codeValue + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.gameCode").value(gameCode));

        mockMvc.perform(get("/api/v1/store/games")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath(
                        "$.data[?(@.gameCode == '" + gameCode + "')].owned"
                ).value(true))
                .andExpect(jsonPath(
                        "$.data[?(@.gameCode == '" + gameCode + "')].installed"
                ).value(false));
    }
}
