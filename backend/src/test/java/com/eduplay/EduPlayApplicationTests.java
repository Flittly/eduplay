package com.eduplay;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class EduPlayApplicationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JsonMapper jsonMapper;

    @Test
    void healthEndpointReturnsUp() throws Exception {
        mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.status").value("UP"));
    }

    @Test
    void guestCanPlayGameAndEarnPoints() throws Exception {
        MvcResult guestResult = mockMvc.perform(post("/api/v1/users/guest")
                        .contentType("application/json")
                        .content("{\"nickname\":\"测试游客\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").isNumber())
                .andReturn();

        JsonNode guestJson = jsonMapper.readTree(
                guestResult.getResponse().getContentAsString()
        );
        long userId = guestJson.path("data").path("id").asLong();

        mockMvc.perform(get("/api/v1/games"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].gameCode").value("province_puzzle"));

        MvcResult sessionResult = mockMvc.perform(post("/api/v1/games/province_puzzle/sessions")
                        .contentType("application/json")
                        .content("{\"userId\":" + userId + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sessionNo").isString())
                .andReturn();

        JsonNode sessionJson = jsonMapper.readTree(
                sessionResult.getResponse().getContentAsString()
        );
        String sessionNo = sessionJson.path("data").path("sessionNo").asText();

        mockMvc.perform(post("/api/v1/games/province_puzzle/sessions/" + sessionNo + "/complete")
                        .contentType("application/json")
                        .content("{\"userId\":" + userId
                                + ",\"score\":60,\"correctCount\":6,\"totalCount\":6}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.pointsAwarded").value(60))
                .andExpect(jsonPath("$.data.balance").value(60));

        mockMvc.perform(get("/api/v1/users/" + userId + "/points"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.balance").value(60));
    }
}
