'use strict';

(() => {
    const dialog = document.getElementById('site-search');
    const input = document.getElementById('site-search-input');
    const results = document.getElementById('site-search-results');
    const status = document.getElementById('site-search-status');

    if (!dialog || !input || !results || !status) {
        return;
    }

    const provider = input.dataset.searchProvider || 'auto';
    const searchPath = input.dataset.searchPath || '/search.xml';
    const limit = Math.max(1, Number.parseInt(input.dataset.searchLimit || '20', 10) || 20);
    const algoliaConfig = {
        applicationID: input.dataset.algoliaApplicationId || '',
        apiKey: input.dataset.algoliaApiKey || '',
        indexName: input.dataset.algoliaIndexName || ''
    };

    let localEntriesPromise = null;
    let algoliaIndex = null;
    let algoliaUnavailable = false;
    let currentResults = [];
    let activeIndex = -1;
    let debounceTimer = null;
    let requestSequence = 0;
    let lastTrigger = null;

    function normalize(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function htmlToText(value) {
        const html = String(value || '');
        if (!html) {
            return '';
        }

        const parsed = new DOMParser().parseFromString(
            `<div>${html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')}</div>`,
            'text/html'
        );
        return normalize(parsed.body ? parsed.body.textContent : html.replace(/<[^>]*>/g, ''));
    }

    function safeUrl(value) {
        try {
            const url = new URL(value, window.location.origin);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                return url.href;
            }
        } catch (_error) {
            return '#';
        }
        return '#';
    }

    function localEntryFromElement(entry) {
        const titleElement = entry.querySelector('title');
        const urlElement = entry.querySelector('url');
        const contentElement = entry.querySelector('content');
        const title = normalize(titleElement ? titleElement.textContent : '无标题');
        const content = htmlToText(contentElement ? contentElement.textContent : '');

        return {
            title,
            link: safeUrl(urlElement ? urlElement.textContent.trim() : ''),
            excerpt: content,
            searchText: `${title} ${content}`.toLowerCase()
        };
    }

    function loadLocalEntries() {
        if (!localEntriesPromise) {
            localEntriesPromise = fetch(searchPath, { credentials: 'same-origin' })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`搜索数据请求失败：${response.status}`);
                    }
                    return response.text();
                })
                .then((xmlText) => {
                    const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
                    if (xml.querySelector('parsererror')) {
                        throw new Error('搜索数据 XML 格式无效');
                    }
                    return Array.from(xml.querySelectorAll('entry')).map(localEntryFromElement);
                })
                .catch((error) => {
                    localEntriesPromise = null;
                    throw error;
                });
        }

        return localEntriesPromise;
    }

    function canUseAlgolia() {
        return !algoliaUnavailable
            && provider !== 'local'
            && algoliaConfig.applicationID
            && algoliaConfig.apiKey
            && algoliaConfig.indexName
            && typeof window.algoliasearch === 'function';
    }

    function getAlgoliaIndex() {
        if (!algoliaIndex) {
            const client = window.algoliasearch(algoliaConfig.applicationID, algoliaConfig.apiKey);
            algoliaIndex = client.initIndex(algoliaConfig.indexName);
        }
        return algoliaIndex;
    }

    function searchAlgolia(query) {
        return new Promise((resolve, reject) => {
            getAlgoliaIndex().search(query, { hitsPerPage: limit }, (error, response) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve((response.hits || []).map((hit) => ({
                    title: normalize(hit.title || '无标题'),
                    link: safeUrl(hit.permalink || ''),
                    excerpt: htmlToText(hit.excerpt || '')
                })));
            });
        });
    }

    function snippet(content, query, maxLength = 150) {
        if (!content) {
            return '';
        }

        const normalizedQuery = normalize(query).toLowerCase();
        const matchIndex = normalizedQuery ? content.toLowerCase().indexOf(normalizedQuery) : -1;
        if (matchIndex <= 0) {
            return content.length > maxLength ? `${content.slice(0, maxLength)}...` : content;
        }

        const start = Math.max(0, matchIndex - 45);
        const end = Math.min(content.length, start + maxLength);
        return `${start > 0 ? '...' : ''}${content.slice(start, end)}${end < content.length ? '...' : ''}`;
    }

    function scoreLocalEntry(entry, terms) {
        let score = 0;
        const title = entry.title.toLowerCase();

        for (const term of terms) {
            const titleIndex = title.indexOf(term);
            const contentIndex = entry.searchText.indexOf(term);
            if (titleIndex === -1 && contentIndex === -1) {
                return -1;
            }

            if (titleIndex === 0) {
                score += 100;
            } else if (titleIndex > -1) {
                score += 70;
            } else {
                score += 25;
            }
            score += Math.min(20, Math.max(0, 12 - contentIndex / 200));
        }

        return score;
    }

    async function searchLocal(query) {
        const entries = await loadLocalEntries();
        const terms = normalize(query).toLowerCase().split(' ').filter(Boolean);

        return entries
            .map((entry) => ({ entry, score: scoreLocalEntry(entry, terms) }))
            .filter((item) => item.score >= 0)
            .sort((left, right) => (
                right.score - left.score
                || left.entry.title.localeCompare(right.entry.title, 'zh-CN')
            ))
            .slice(0, limit)
            .map(({ entry }) => ({
                title: entry.title,
                link: entry.link,
                excerpt: snippet(entry.excerpt, query)
            }));
    }

    function clearResults() {
        currentResults = [];
        activeIndex = -1;
        results.replaceChildren();
    }

    function setActiveResult(nextIndex) {
        const links = results.querySelectorAll('.site-search-result-link');
        if (links.length === 0) {
            activeIndex = -1;
            return;
        }

        activeIndex = (nextIndex + links.length) % links.length;
        links.forEach((link, index) => {
            const active = index === activeIndex;
            link.classList.toggle('is-active', active);
            link.setAttribute('aria-selected', String(active));
            if (active) {
                link.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function renderResults(items) {
        clearResults();

        if (items.length === 0) {
            status.textContent = '没有找到相关文章';
            return;
        }

        currentResults = items;
        status.textContent = `找到 ${items.length} 篇文章`;

        items.forEach((item, index) => {
            const result = document.createElement('li');
            const link = document.createElement('a');
            const title = document.createElement('strong');
            const excerpt = document.createElement('span');

            result.className = 'site-search-result';
            link.className = 'site-search-result-link';
            link.href = item.link;
            link.setAttribute('role', 'option');
            link.setAttribute('aria-selected', 'false');
            link.dataset.resultIndex = String(index);
            title.textContent = item.title;
            link.appendChild(title);

            if (item.excerpt) {
                excerpt.className = 'site-search-result-excerpt';
                excerpt.textContent = item.excerpt;
                link.appendChild(excerpt);
            }

            result.appendChild(link);
            results.appendChild(result);
        });
    }

    async function runSearch(query) {
        const requestId = ++requestSequence;
        status.textContent = '正在搜索...';
        clearResults();

        let items = null;
        if (canUseAlgolia()) {
            try {
                items = await searchAlgolia(query);
            } catch (_error) {
                algoliaUnavailable = true;
            }
        }

        if (!items) {
            items = await searchLocal(query);
        }

        if (requestId !== requestSequence || input.value.trim() !== query) {
            return;
        }

        renderResults(items);
    }

    function scheduleSearch() {
        const query = input.value.trim();
        window.clearTimeout(debounceTimer);

        if (!query) {
            requestSequence += 1;
            clearResults();
            status.textContent = '输入标题或关键词开始搜索';
            return;
        }

        status.textContent = '正在搜索...';
        debounceTimer = window.setTimeout(() => {
            runSearch(query).catch(() => {
                clearResults();
                status.textContent = '搜索暂不可用，请稍后重试';
            });
        }, 160);
    }

    function openSearch(trigger) {
        lastTrigger = trigger || document.activeElement;
        dialog.hidden = false;
        document.documentElement.classList.add('site-search-open');
        window.requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    }

    function closeSearch() {
        dialog.hidden = true;
        document.documentElement.classList.remove('site-search-open');
        window.clearTimeout(debounceTimer);
        requestSequence += 1;
        if (lastTrigger && typeof lastTrigger.focus === 'function') {
            lastTrigger.focus();
        }
    }

    document.querySelectorAll('[data-search-open]').forEach((trigger) => {
        trigger.addEventListener('click', () => openSearch(trigger));
    });

    dialog.querySelectorAll('[data-search-close]').forEach((button) => {
        button.addEventListener('click', closeSearch);
    });

    input.addEventListener('input', scheduleSearch);

    input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveResult(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter' && activeIndex >= 0 && currentResults[activeIndex]) {
            event.preventDefault();
            window.location.href = currentResults[activeIndex].link;
        } else if (event.key === 'Escape') {
            closeSearch();
        }
    });

    document.addEventListener('keydown', (event) => {
        const target = event.target;
        const isTyping = target instanceof HTMLElement
            && (target.matches('input, textarea, select') || target.isContentEditable);

        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            openSearch(document.activeElement);
        } else if (event.key === '/' && !isTyping && dialog.hidden) {
            event.preventDefault();
            openSearch(document.activeElement);
        } else if (event.key === 'Escape' && !dialog.hidden) {
            closeSearch();
        }
    });
})();
