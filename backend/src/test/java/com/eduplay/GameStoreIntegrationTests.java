package com.eduplay;

import com.eduplay.game.ActivationCode;
import com.eduplay.game.ActivationCodeRepository;
import com.eduplay.game.GameProductRepository;
import com.eduplay.game.UserEntitlement;
import com.eduplay.game.UserEntitlementRepository;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
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
class GameStoreIntegrationTests {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JsonMapper jsonMapper;

    @Autowired
    private ActivationCodeRepository activationCodeRepository;

    @Autowired
    private UserEntitlementRepository entitlementRepository;

    @Autowired
    private GameProductRepository gameProductRepository;

    /**
     * 已存在一条 **非 ACTIVE** 的权益记录时再次兑换，必须把它复用成 ACTIVE。
     *
     * <p>改造前这里是"查到非 ACTIVE 就放行，然后 insert 一条新行"，直接撞
     * {@code uk_user_entitlement(user_id, game_id)} —— DataIntegrityViolation
     * 被兜底成 500，而且旧版提示还会被译成"字段超长"，排查方向完全跑偏。
     */
    @Test
    void redeemReusesInactiveEntitlement() throws Exception {
        String username = "redeem_" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult registerResult = mockMvc.perform(post("/api/v1/auth/local/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username
                                + "\",\"password\":\"123456\",\"nickname\":\"复兑测试\"}"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode registerJson = jsonMapper.readTree(
                registerResult.getResponse().getContentAsString()
        );
        String token = registerJson.path("data").path("token").asText();
        long userId = registerJson.path("data").path("user").path("id").asLong();

        String first = "REUSE-" + UUID.randomUUID().toString().substring(0, 10).toUpperCase();
        saveUnusedCode(first);
        mockMvc.perform(post("/api/v1/store/redeem")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + first + "\"}"))
                .andExpect(status().isOk());

        Long gameId = gameProductRepository.findByGameCode("province_puzzle")
                .orElseThrow().getId();
        UserEntitlement entitlement = entitlementRepository
                .findByUserIdAndGameId(userId, gameId)
                .orElseThrow();
        entitlement.setStatus("REVOKED");
        entitlementRepository.saveAndFlush(entitlement);

        String second = "REUSE-" + UUID.randomUUID().toString().substring(0, 10).toUpperCase();
        saveUnusedCode(second);
        mockMvc.perform(post("/api/v1/store/redeem")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + second + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("ACTIVE"));

        UserEntitlement after = entitlementRepository
                .findByUserIdAndGameId(userId, gameId)
                .orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals("ACTIVE", after.getStatus());
    }

    private void saveUnusedCode(String codeValue) {
        ActivationCode activationCode = new ActivationCode();
        activationCode.setGameCode("province_puzzle");
        activationCode.setCode(codeValue);
        activationCode.setStatus("UNUSED");
        activationCode.setCreatedAt(Instant.now());
        activationCodeRepository.save(activationCode);
    }

    @Test
    void redeemInstallAndListFlow() throws Exception {
        String username = "store_" + UUID.randomUUID().toString().substring(0, 8);
        MvcResult registerResult = mockMvc.perform(post("/api/v1/auth/local/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username
                                + "\",\"password\":\"123456\",\"nickname\":\"商城测试\"}"))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode registerJson = jsonMapper.readTree(
                registerResult.getResponse().getContentAsString()
        );
        String token = registerJson.path("data").path("token").asText();

        String codeValue = "TEST-" + UUID.randomUUID().toString().substring(0, 12).toUpperCase();
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

        mockMvc.perform(get("/api/v1/me/games")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].gameCode").value("province_puzzle"))
                .andExpect(jsonPath("$.data[0].installedVersion").exists());
    }
}
