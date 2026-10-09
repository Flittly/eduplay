package com.eduplay.game;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface GamePackageRepository extends JpaRepository<GamePackage, Long> {

    Optional<GamePackage> findByGameIdAndVersion(Long gameId, String version);

    /**
     * ⚠️ **不要用它取“最新版”** —— 它是 {@code ORDER BY version DESC}，而 version 是**字符串**，
     * 数据库按**字典序**排：{@code "2.5.9" > "2.5.10"}（比到第 5 个字符 '9'(0x39) vs '1'(0x31)）。
     * 想取最新版请用 {@link #findLatestByGameId(Long)}。
     *
     * <p>保留本方法是给“确实要字符串序”的少数场景用的；历史调用点已全部改掉。
     */
    Optional<GamePackage> findFirstByGameIdOrderByVersionDesc(Long gameId);

    List<GamePackage> findByGameIdOrderByVersionDesc(Long gameId);

    boolean existsByGameIdAndVersion(Long gameId, String version);

    /**
     * 取某个游戏的**最新**包记录（按版本号语义，不是字符串）。
     *
     * <p>⚠️ 2026-10-09 踩过的真坑：全项目原先一律用
     * {@code findFirstByGameIdOrderByVersionDesc}，即数据库的字符串降序。版本号一旦出现
     * **两位数小版本**（2.5.9 → 2.5.10），字典序会把旧的排在前面
     * ⇒ 商城列表、下载包、导出包、点“安装”装出来的，**全都是个位数的那一版**。
     * 当时 mountain_zones 发到 v2.5.10，四处读到的却都还是 v2.5.9。
     */
    default Optional<GamePackage> findLatestByGameId(Long gameId) {
        return findByGameIdOrderByVersionDesc(gameId).stream()
                .max((a, b) -> compareVersion(a.getVersion(), b.getVersion()));
    }

    /**
     * 批量取这些游戏的全部包记录，调用方用 {@link #compareVersion} 挑出各自最新那条。
     *
     * <p>⚠️ 注意**不要**写回 {@code and p.version = (select max(p2.version) ...)}：JPQL 的
     * {@code max()} 同样作用在字符串上，正是上面那个坑的批量版本。
     */
    @Query("select p from GamePackage p where p.gameId in :gameIds")
    List<GamePackage> findByGameIdIn(@Param("gameIds") Collection<Long> gameIds);

    /**
     * 按**数字段**比较版本号：{@code "2.5.10" > "2.5.9"}。
     *
     * <p>逐段转 int 比大小（2.10.0 &gt; 2.9.0）；段数不同时缺的段按 0 算；
     * 非数字段（如预发布后缀 {@code 1.0.0-beta}）只取开头的数字前缀，取不到算 0 —— 不抛异常。
     */
    static int compareVersion(String a, String b) {
        String[] pa = (a == null || a.isEmpty()) ? new String[0] : a.split("\\.");
        String[] pb = (b == null || b.isEmpty()) ? new String[0] : b.split("\\.");
        int n = Math.max(pa.length, pb.length);
        for (int i = 0; i < n; i++) {
            int va = i < pa.length ? numericPrefix(pa[i]) : 0;
            int vb = i < pb.length ? numericPrefix(pb[i]) : 0;
            if (va != vb) {
                return Integer.compare(va, vb);
            }
        }
        return 0;
    }

    /** 取段首连续数字；没有数字返回 0。 */
    private static int numericPrefix(String segment) {
        int i = 0;
        while (i < segment.length() && Character.isDigit(segment.charAt(i))) {
            i++;
        }
        if (i == 0) {
            return 0;
        }
        try {
            return Integer.parseInt(segment.substring(0, i));
        } catch (NumberFormatException ex) {
            return 0;
        }
    }
}
