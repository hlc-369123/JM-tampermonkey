// ==UserScript==
// @name         即梦AI高清图片下载器
// @namespace    http://tampermonkey.net/
// @version      14.0
// @description  智能识别并下载即梦画布页中的高清原图，自动过滤参考图和缩略图
// @author       Tabbit Agent
// @match        https://jimeng.jianying.com/ai-tool/canvas/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ====== 配置 ======
    const CONFIG = {
        PREFIX: '[HD]',
        MIN_WIDTH: 360,      // 最小宽度阈值
        HIGH_RES: 720,       // 高清分辨率阈值
        DELAY_MS: 300,       // 下载间隔（毫秒）
        MAX_DOWNLOAD: 99     // 最大下载数量
    };

    // ====== 日志工具 ======
    function log(msg) {
        console.log(CONFIG.PREFIX, msg);
    }

    // ====== 状态面板 ======
    let panel = null;

    function createPanel() {
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'jimeng-sxdl-panel';
        panel.innerHTML = `
            <style>
                #jimeng-sxdl-panel {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 999999;
                    background: linear-gradient(135deg, #1a5f2a 0%, #2d8a3e 100%);
                    color: #fff;
                    padding: 20px 24px;
                    border-radius: 16px;
                    font-size: 14px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    max-width: 440px;
                    box-shadow: 0 12px 40px rgba(26, 95, 42, 0.5);
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    line-height: 1.7;
                    user-select: none;
                }
                #jimeng-sxdl-panel .sxdl-title {
                    font-size: 16px;
                    font-weight: 700;
                    margin-bottom: 16px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid rgba(255,255,255,0.2);
                }
                #jimeng-sxdl-panel .sxdl-status {
                    margin-bottom: 16px;
                    min-height: 48px;
                    white-space: pre-wrap;
                    word-break: break-all;
                }
                #jimeng-sxdl-panel .sxdl-row {
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    margin-bottom: 12px;
                }
                #jimeng-sxdl-panel input[type="number"] {
                    width: 70px;
                    padding: 8px 12px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    background: rgba(255,255,255,0.15);
                    color: #fff;
                    text-align: center;
                }
                #jimeng-sxdl-panel input[type="number"]::placeholder {
                    color: rgba(255,255,255,0.6);
                }
                #jimeng-sxdl-panel button {
                    flex: 1;
                    padding: 10px 20px;
                    border: none;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                #jimeng-sxdl-panel .btn-download {
                    background: linear-gradient(135deg, #ff6b35, #f7931e);
                    color: #fff;
                }
                #jimeng-sxdl-panel .btn-download:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(255, 107, 53, 0.4);
                }
                #jimeng-sxdl-panel .btn-download:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                    transform: none;
                }
                #jimeng-sxdl-panel .btn-close {
                    position: absolute;
                    top: 10px;
                    right: 12px;
                    background: transparent;
                    color: rgba(255,255,255,0.7);
                    font-size: 18px;
                    padding: 4px 8px;
                    cursor: pointer;
                    border: none;
                }
                #jimeng-sxdl-panel .btn-close:hover {
                    color: #fff;
                }
            </style>
            <button class="btn-close" id="sxdl-close" title="关闭面板">&times;</button>
            <div class="sxdl-title">🏺 高清图片下载器</div>
            <div class="sxdl-status" id="sxdl-status">就绪 - 点击下方按钮开始扫描</div>
            <div class="sxdl-row">
                <label>下载数量:</label>
                <input type="number" id="sxdl-count" value="99" min="1" max="99" placeholder="全部">
            </div>
            <div class="sxdl-row">
                <button class="btn-download" id="sxdl-start">🔍 扫描并下载</button>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById('sxdl-close').addEventListener('click', function() {
            if (panel) { panel.remove(); panel = null; }
        });
        document.getElementById('sxdl-start').addEventListener('click', startDownload);

        return panel;
    }

    function updateStatus(text) {
        const el = document.getElementById('sxdl-status');
        if (el) el.textContent = text;
    }

    // ====== 核心扫描逻辑 ======
    function scanImages() {
        const allImgs = Array.from(document.querySelectorAll('img'));
        
        // 收集所有 dreamina 图片及其元信息
        const candidates = allImgs.map(function(img) {
            var s = img.src || '';
            if (!s.includes('dreamina-sign.byteimg.com')) return null;
            if (img.offsetWidth < 30 || img.naturalWidth < 10) return null;

            // 提取URL基础标识（去掉尺寸和签名参数）
            var urlBase = s.split('~')[0];

            // 检测DOM位置
            var isInMainArea = false;
            var isInRefArea = false;
            var el = img.parentElement;
            var depth = 0;
            while (el && depth < 15) {
                var tag = (el.tagName || '').toLowerCase();
                var cls = el.className || '';
                if (cls && typeof cls === 'string') {
                    // 主画布区域特征
                    if (cls.includes('canvas-container') ||
                        cls.includes('canvas-content') ||
                        cls.includes('main-canvas') ||
                        cls.includes('image-list') ||
                        cls.includes('asset-image')) {
                        isInMainArea = true;
                    }
                    // 参考图/缩略图区域特征
                    if (cls.includes('ref-image') ||
                        cls.includes('reference') ||
                        cls.includes('thumbnail') ||
                        cls.includes('thumb') ||
                        cls.includes('sidebar-thumb')) {
                        isInRefArea = true;
                    }
                }
                el = el.parentElement;
                depth++;
            }

            return {
                img: img,
                src: s,
                urlBase: urlBase,
                w: img.naturalWidth,
                h: img.naturalHeight,
                displayW: img.offsetWidth,
                isInMainArea: isInMainArea,
                isInRefArea: isInRefArea,
                isHighRes: img.naturalWidth >= CONFIG.HIGH_RES
            };
        }).filter(Boolean);

        log('共发现 ' + candidates.length + ' 个 dreamina 图片节点');

        // 去重 + 智能筛选
        var seen = new Map();
        var refUrls = new Set();

        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var existing = seen.get(c.urlBase);
            if (!existing) {
                seen.set(c.urlBase, c);
            } else {
                var existingScore = (existing.isHighRes ? 100 : 0) + (existing.isInMainArea ? 50 : 0) + existing.displayW;
                var newScore = (c.isHighRes ? 100 : 0) + (c.isInMainArea ? 50 : 0) + c.displayW;
                if (newScore > existingScore) {
                    seen.set(c.urlBase, c);
                }
            }

            if (c.isInRefArea) {
                refUrls.add(c.urlBase);
            }
        }

        // 最终列表：只保留高分辨率图片，排除纯参考图
        var finalList = Array.from(seen.values())
            .filter(function(c) { return c.w >= CONFIG.MIN_WIDTH; })
            .sort(function(a, b) { return b.w - a.w; });

        var totalFound = finalList.length;
        var highResCount = finalList.filter(function(c) { return c.isHighRes; }).length;
        var skippedRefs = refUrls.size;

        log('去重后: ' + totalFound + ' 张 (高清:' + highResCount + ', 参考图已过滤:' + skippedRefs + ')');

        return {
            list: finalList,
            total: totalFound,
            highRes: highResCount,
            skippedRefs: skippedRefs,
            rawCount: candidates.length
        };
    }

    // ====== 下载单张图片 ======
    async function downloadImage(item, index) {
        try {
            var img = item.img;
            var urlBase = item.urlBase;
            var w = item.w;
            var h = item.h;

            // 用 createImageBitmap 提取像素数据（绕过CORS/签名）
            var bm = await createImageBitmap(img).catch(function() { return null; });
            if (!bm) return false;

            var cv = document.createElement('canvas');
            cv.width = bm.width;
            cv.height = bm.height;
            cv.getContext('2d').drawImage(bm, 0, 0);

            var blob = await new Promise(function(resolve) { cv.toBlob(resolve, 'image/png'); });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;

            // 文件名格式：序号.png
            var tag = w >= 1440 ? 'UHD' : w >= 720 ? 'HD' : w >= 400 ? 'MD' : 'SD';
            a.download = String(index + 1).padStart(2, '0') + '.png';
            a.click();
            URL.revokeObjectURL(url);
            bm.close();
            return true;
        } catch (e) {
            log('下载异常: ' + e.message);
            return false;
        }
    }

    // ====== 主下载流程 ======
    async function startDownload() {
        var btn = document.getElementById('sxdl-start');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ 扫描中...'; }

        updateStatus('⏳ 正在扫描图片...');
        
        var result = scanImages();
        var finalList = result.list;

        if (finalList.length === 0) {
            updateStatus('❌ 未找到\n请确认页面已加载完成');
            if (btn) { btn.disabled = false; btn.textContent = '🔍 扫描并下载'; }
            return;
        }

        // 获取用户输入的下载数量
        var countInput = document.getElementById('sxdl-count');
        var maxDl = countInput ? parseInt(countInput.value) || CONFIG.MAX_DOWNLOAD : CONFIG.MAX_DOWNLOAD;
        var total = Math.min(maxDl, finalList.length);

        updateStatus('🔍 发现 ' + result.total + ' 张图片\n(高清:' + result.highRes + ' | 已过滤参考图:' + result.skippedRefs + ')\n⏳ 准备下载...');

        var ok = 0, fail = 0, skipped = 0;
        var downloaded = new Set();

        for (var i = 0; i < total; i++) {
            var item = finalList[i];
            var resTag = item.isHighRes ? '🔴' : '🟡';
            updateStatus(resTag + ' (' + (i + 1) + '/' + total + ') ' + item.w + '×' + item.h + '...');

            // 防重复
            if (downloaded.has(item.urlBase)) {
                skipped++;
                continue;
            }
            downloaded.add(item.urlBase);

            var success = await downloadImage(item, i);
            if (success) {
                ok++;
                log((i + 1) + '/' + total + ' ✅ ' + item.w + '×' + item.h);
            } else {
                fail++;
                log((i + 1) + '/' + total + ' ❌');
            }

            if (i < total - 1) {
                await new Promise(function(r) { setTimeout(r, CONFIG.DELAY_MS); });
            }
        }

        // 最终报告
        var summary = '✅ 完成!\n下载: ' + ok + ' 张';
        if (fail > 0) summary += '\n失败: ' + fail;
        if (skipped > 0) summary += '\n跳过重复: ' + skipped;
        summary += '\n\n📊 统计: 扫描' + result.rawCount + '个 → 去重后' + result.total + '张 → 高清' + result.highRes + '张';

        log(summary);
        updateStatus(summary);

        if (btn) { btn.disabled = false; btn.textContent = '🔍 重新下载'; }
    }

    // ====== 初始化 ======
    function init() {
        // 等待页面加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        // 延迟一点确保画布渲染完毕
        setTimeout(function() {
            createPanel();
            log('面板已就绪 - 即梦下载器 v14.0');
        }, 1000);
    }

    init();
})();
