package com.eduplay.points;

import com.eduplay.common.BusinessException;
import com.eduplay.common.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PointsService {

    private final PointsAccountRepository accountRepository;
    private final PointsLedgerRepository ledgerRepository;

    public PointsService(
            PointsAccountRepository accountRepository,
            PointsLedgerRepository ledgerRepository
    ) {
        this.accountRepository = accountRepository;
        this.ledgerRepository = ledgerRepository;
    }

    @Transactional
    public int awardPoints(
            Long userId,
            int amount,
            String bizType,
            String bizId,
            String idempotencyKey
    ) {
        return changePoints(userId, amount, "EARN", bizType, bizId, idempotencyKey);
    }

    @Transactional
    public int initializePoints(
            Long userId,
            int amount,
            String bizType,
            String bizId
    ) {
        return changePoints(userId, amount, "INIT", bizType, bizId, "init:" + bizId);
    }

    private int changePoints(
            Long userId,
            int amount,
            String changeType,
            String bizType,
            String bizId,
            String idempotencyKey
    ) {
        if (amount < 0) {
            throw new BusinessException("INVALID_POINTS", "积分不能为负数");
        }
        if (ledgerRepository.existsByIdempotencyKey(idempotencyKey)) {
            throw new BusinessException("DUPLICATE_POINTS_EVENT", "积分事件重复提交");
        }
        PointsAccount account = accountRepository.findByUserId(userId)
                .orElseGet(() -> createAccount(userId));

        int balanceAfter = account.getBalance() + amount;
        account.setBalance(balanceAfter);
        accountRepository.saveAndFlush(account);

        PointsLedger ledger = new PointsLedger();
        ledger.setAccountId(account.getId());
        ledger.setUserId(userId);
        ledger.setChangeType(changeType);
        ledger.setAmount(amount);
        ledger.setBalanceAfter(balanceAfter);
        ledger.setBizType(bizType);
        ledger.setBizId(bizId);
        ledger.setIdempotencyKey(idempotencyKey);
        ledgerRepository.saveAndFlush(ledger);

        return balanceAfter;
    }

    @Transactional(readOnly = true)
    public PointsSummary getSummary(Long userId) {
        PointsAccount account = accountRepository.findByUserId(userId)
                .orElseThrow(() -> new NotFoundException("积分账户不存在: " + userId));
        return new PointsSummary(userId, account.getBalance());
    }

    private PointsAccount createAccount(Long userId) {
        PointsAccount account = new PointsAccount();
        account.setUserId(userId);
        account.setBalance(0);
        account.setVersion(0L);
        return accountRepository.save(account);
    }

    public record PointsSummary(Long userId, int balance) {
    }
}
