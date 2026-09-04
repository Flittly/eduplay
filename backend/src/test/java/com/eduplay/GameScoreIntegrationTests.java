package com.eduplay;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class GameScoreIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JsonMapper jsonMapper;

    @Test
    void submitGameScoreIsIdempotent() throws Exception {
        String username = "score_" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult registerResult = mockMvc.perform(post("/api/v1/auth/local/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username
                                + "\",\"password\":\"123456\",\"nickname\":\"积分测试\"}"))
                .andExpect(status().isOk())
                .andReturn();

        String token = jsonMapper.readTree(
                registerResult.getResponse().getContentAsString()
        ).path("data").path("token").asText();

        MvcResult studentResult = mockMvc.perform(post("/api/v1/students")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"张三\",\"studentNo\":\"20260001\","
                                + "\"className\":\"高一1班\",\"initialPoints\":0}"))
                .andExpect(status().isOk())
                .andReturn();

        long studentId = jsonMapper.readTree(
                studentResult.getResponse().getContentAsString()
        ).path("data").path("id").asLong();

        String roundId = UUID.randomUUID().toString();
        String body = "{\"studentId\":" + studentId
                + ",\"score\":60,\"roundId\":\"" + roundId + "\"}";

        mockMvc.perform(post("/api/v1/games/province_puzzle/scores")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalPoints").value(60))
                .andExpect(jsonPath("$.data.recorded").value(true));

        mockMvc.perform(post("/api/v1/games/province_puzzle/scores")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalPoints").value(60))
                .andExpect(jsonPath("$.data.recorded").value(false));

        mockMvc.perform(get("/api/v1/students/" + studentId + "/points")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.student.totalPoints").value(60));
    }
}
