package com.eduplay.common;

import java.time.Duration;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 带内容 hash 的静态资源走长期强缓存。
 *
 * <p>前端是 Vite 构建的单页应用，入口 {@code index.html} 文件名固定，而它引用的
 * {@code assets/index-<hash>.js} 里带着内容 hash —— 也就是说「内容变了，文件名就变」。
 * 两类文件的正确策略正好相反：
 *
 * <ul>
 *   <li>{@code index.html}：必须每次回源校验，否则升级后用户看到的还是旧页面
 *       （见 {@code application.yml} 的
 *       {@code spring.web.resources.cache.cachecontrol.no-cache}）；</li>
 *   <li>{@code /assets/**}：文件名自带版本，可以放心缓存一年，省掉本地回环上的
 *       重复校验（启动优化里 splash 过渡页之后的首次加载会用到）。</li>
 * </ul>
 *
 * <p>这里只注册更具体的 {@code /assets/**} 模式；Spring Boot 自动配置的
 * {@code /**} 仍然负责其余全部静态资源（含 index.html 与 SPA 深链接转发），
 * 按模式具体度比较后由本配置胜出。
 */
@Configuration
public class StaticResourceCacheConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/assets/**")
                .addResourceLocations("classpath:/static/assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(365))
                        .cachePublic()
                        .immutable());
    }
}
