let ENV = window.GRIMOIRE_ENV;
let mde = null; 
let fnMde = null;
let activeEl = null;
let sortableInstance = null;
let allExpanded = false;
let activeTagForColor = null;
const TAG_NAME_MAX_LEN = 60;

function csrfFetch(url, options = {}) {
    const nextOptions = { ...options };
    const headers = new Headers(options.headers || {});
    if (ENV && ENV.csrfToken) {
        headers.set('X-CSRF-Token', ENV.csrfToken);
    }
    nextOptions.headers = headers;
    return fetch(url, nextOptions);
}

function debounce(fn, wait = 150) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), wait);
    };
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    template.content.querySelectorAll('script, iframe, object, embed, link, meta, style').forEach((node) => node.remove());

    template.content.querySelectorAll('*').forEach((node) => {
        Array.from(node.attributes).forEach((attr) => {
            const attrName = attr.name.toLowerCase();
            const attrValue = String(attr.value || '').trim().toLowerCase();
            if (attrName.startsWith('on')) {
                node.removeAttribute(attr.name);
                return;
            }
            if ((attrName === 'href' || attrName === 'src' || attrName === 'xlink:href') && attrValue.startsWith('javascript:')) {
                node.removeAttribute(attr.name);
            }
        });
    });

    return template.innerHTML;
}

window.openColorPicker = function(e, tagName) {
    e.preventDefault();
    e.stopPropagation();
    activeTagForColor = tagName;
    populateColorPicker();
    
    const picker = document.getElementById('color-picker');
    picker.style.display = 'block'; 
    
    // SMART POSITIONING: If on mobile, CSS perfectly centers it. If desktop, drop it down.
    if (window.innerWidth > 600) {
        const barRect = e.target.getBoundingClientRect();
        const pickerRect = picker.getBoundingClientRect();
        
        let x = barRect.left + (barRect.width / 2) - (pickerRect.width / 2);
        let y = barRect.bottom + 10; 
        
        if (y + pickerRect.height > window.innerHeight) { y = barRect.top - pickerRect.height - 10; }
        if (x < 10) x = 10;
        if (x + pickerRect.width > window.innerWidth) x = window.innerWidth - pickerRect.width - 10;
        
        picker.style.left = x + 'px'; 
        picker.style.top = y + 'px';
        picker.style.transform = 'none'; // Resets any leftover mobile transforms
    } else {
        picker.style.left = '';
        picker.style.top = '';
        picker.style.transform = '';
    }
}

window.switchView = function(viewName) {
    const vTracker = document.getElementById('view-tracker');
    const vJournal = document.getElementById('view-journal');
    
    // Syncs the mobile dropdown visually
    const mNav = document.getElementById('mobile-nav');
    if (mNav) mNav.value = viewName; 
    
    if (viewName === 'tracker') {
        vTracker.style.opacity = '0';
        setTimeout(() => {
            vJournal.style.display = 'none'; vTracker.style.display = 'block';
            document.getElementById('tab-tracker').className = 'active-view'; document.getElementById('tab-journal').className = 'inactive-view';
            setTimeout(() => vTracker.style.opacity = '1', 50);
        }, 200);
    } else {
        vJournal.style.opacity = '0';
        setTimeout(() => {
            vTracker.style.display = 'none'; vJournal.style.display = 'block';
            document.getElementById('tab-tracker').className = 'inactive-view'; document.getElementById('tab-journal').className = 'active-view';
            renderJournal(); 
            setTimeout(() => vJournal.style.opacity = '1', 50);
        }, 200);
    }
}

function hslToHex(h, s, l) {
    l /= 100; const a = s * Math.min(l, 1 - l) / 100;
    const f = n => { const k = (n + h / 30) % 12; const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); return Math.round(255 * color).toString(16).padStart(2, '0'); };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function getRandomHueWithinBounds(hueName) {
    if (hueName === 'any') return Math.floor(Math.random() * 360);
    const ranges = { 'red': [[0, 15], [345, 360]], 'orange': [[15, 45]], 'yellow': [[45, 75]], 'green': [[75, 165]], 'cyan': [[165, 195]], 'blue': [[195, 255]], 'purple': [[255, 285]], 'pink': [[285, 345]] };
    const r = ranges[hueName]; const pick = r[Math.floor(Math.random() * r.length)];
    return Math.floor(Math.random() * (pick[1] - pick[0])) + pick[0];
}

window.populateColorPicker = function() {
    const container = document.getElementById('color-options'); container.innerHTML = '';
    const tierSelection = document.getElementById('cp-tier').value, hueSelection = document.getElementById('cp-hue').value;

    for(let i=0; i<8; i++) {
        let h = getRandomHueWithinBounds(hueSelection), s, l;
        if (tierSelection === 'bold') { s = 85; l = 75; }
        else if (tierSelection === 'medium') { s = 65; l = 85; }
        else if (tierSelection === 'whisper') { s = 45; l = 93; }
        else { const tiers = [{s:85,l:75}, {s:65,l:85}, {s:45,l:93}]; let randTier = tiers[Math.floor(Math.random() * tiers.length)]; s = randTier.s; l = randTier.l; }
        s = Math.max(20, Math.min(100, s + (Math.random() * 10 - 5))); l = Math.max(20, Math.min(98, l + (Math.random() * 6 - 3)));
        let hexColor = hslToHex(h, s, l); 
        const dot = document.createElement('div'); dot.className = 'color-dot'; dot.style.backgroundColor = hexColor; dot.onclick = () => selectColor(hexColor);
        container.appendChild(dot);
    }
}

// THE SIMPLIFIED HEX VALIDATOR
window.selectHexColor = function() { 
    let hex = document.getElementById('hex-color-input').value.trim();

    if (/^#?[0-9A-F]{3}$/i.test(hex)) {
        hex = hex.replace('#', '');
        hex = `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    } else if (/^[0-9A-F]{6}$/i.test(hex)) {
        hex = '#' + hex;
    } else if (!/^#[0-9A-F]{6}$/i.test(hex)) {
        alert('Please enter a valid hex code (e.g. #FF5500 or #F50)');
        return;
    }

    hex = hex.toUpperCase();
    selectColor(hex); 
}

function selectColor(colorHex) {
    const fd = new FormData(); fd.append('name', activeTagForColor); fd.append('color', colorHex);
    csrfFetch('/update_tag_color', { method: 'POST', body: fd }).then(r => r.json()).then(data => {
        if(data.status === 'success') { ENV.tagsData = data.tags_data; renderTags(); applyColors(); document.getElementById('color-picker').style.display = 'none'; }
    });
}

document.addEventListener('click', (e) => {
    if(!e.target.closest('#color-picker') && !e.target.closest('.pill-color-bar')) { document.getElementById('color-picker').style.display = 'none'; }
});

window.togglePill = function(checkbox) {
    const pill = checkbox.closest('.tag-pill');
    if(checkbox.checked) pill.classList.add('active-pill'); else pill.classList.remove('active-pill');
};

window.closeEditor = function() { document.getElementById('editor').style.display = 'none'; activeEl = null; };

function renderTags() {
    const container = document.getElementById('tag-container'); container.innerHTML = '';
    const sortedTags = Object.keys(ENV.tagsData).sort((a, b) => ENV.tagsData[b].priority - ENV.tagsData[a].priority);
    const isLocked = activeEl && activeEl.dataset.locked === '1';

    sortedTags.forEach(tagName => {
        const tag = ENV.tagsData[tagName];
        const pill = document.createElement('div');
        pill.className = 'tag-pill';
        pill.dataset.tagName = tagName;

        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '≡';

        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'tags';
        checkbox.value = tagName;
        checkbox.disabled = isLocked;
        checkbox.addEventListener('change', () => togglePill(checkbox));

        const nameSpan = document.createElement('span');
        nameSpan.title = tagName;
        nameSpan.textContent = tagName;

        const colorBar = document.createElement('div');
        colorBar.className = 'pill-color-bar';
        colorBar.style.backgroundColor = tag.color;
        colorBar.title = 'Tap to change color';
        colorBar.addEventListener('click', (event) => openColorPicker(event, tagName));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'tag-del-btn';
        deleteButton.textContent = '×';
        deleteButton.style.display = isLocked ? 'none' : 'block';
        deleteButton.addEventListener('click', () => deleteTag(tagName));

        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        label.appendChild(colorBar);

        pill.appendChild(dragHandle);
        pill.appendChild(label);
        pill.appendChild(deleteButton);
        container.appendChild(pill);
    });
    
    if (activeEl) {
        const activeTags = activeEl.dataset.tags ? activeEl.dataset.tags.split(',') : [];
        document.querySelectorAll('input[name="tags"]').forEach(cb => { cb.checked = activeTags.includes(cb.value); togglePill(cb); });
    }
}

function applyColors() {
    const etchedPattern = `repeating-linear-gradient(45deg, rgba(26, 15, 10, 0.05) 0px, rgba(26, 15, 10, 0.05) 2px, transparent 2px, transparent 8px)`;
    document.querySelectorAll('.day').forEach(dayDiv => {
        const dayDate = dayDiv.getAttribute('data-date'); const tagsStr = dayDiv.getAttribute('data-tags'); const paper = dayDiv.querySelector('.cell-paper');
        if (!paper) return;
        
        let sizeUniverse = ENV.tagsData; 
        if (dayDate < ENV.todayStr) {
            let snapshotStr = dayDiv.getAttribute('data-snapshot');
            if (snapshotStr && snapshotStr !== '{}' && snapshotStr !== 'None') { try { let parsed = JSON.parse(snapshotStr); if (Object.keys(parsed).length > 0) sizeUniverse = parsed; } catch(e) {} }
        }

        const tags = (tagsStr || "").split(',').filter(t => t && sizeUniverse[t]);
        if (tags.length === 0) { paper.style.background = etchedPattern; return; }

        const allUniverseNames = Object.keys(sizeUniverse); const N = allUniverseNames.length; if (N === 0) return;
        let minPct = 5; let usablePct = 100 - (N * minPct); if (usablePct < 0) { minPct = 100 / N; usablePct = 0; }
        let globalTotalWeight = allUniverseNames.reduce((sum, name) => sum + Math.pow(sizeUniverse[name].priority, 2), 0);

        let tagSizes = {};
        allUniverseNames.forEach(name => { let weight = Math.pow(sizeUniverse[name].priority, 2); tagSizes[name] = minPct + ((globalTotalWeight > 0 ? (weight / globalTotalWeight) : 0) * usablePct); });

        tags.sort((a, b) => sizeUniverse[b].priority - sizeUniverse[a].priority);
        let currentPct = 0; let gradientStops = [];

        tags.forEach(t => {
            let size = tagSizes[t] || 0; let start = currentPct; let end = currentPct + size;
            let renderColor = (ENV.tagsData[t] && ENV.tagsData[t].color) ? ENV.tagsData[t].color : sizeUniverse[t].color;
            gradientStops.push(`${renderColor} ${start}%`); gradientStops.push(`${renderColor} ${end}%`);
            currentPct += size;
        });

        if (currentPct < 99.9) { gradientStops.push(`transparent ${currentPct}%`); gradientStops.push(`transparent 100%`); }
        paper.style.background = `linear-gradient(to top, ${gradientStops.join(', ')}), ${etchedPattern}`;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    renderTags(); applyColors();

    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        calendarEl.addEventListener('click', (e) => {
            const dayEl = e.target.closest('.day[data-date]');
            if (!dayEl || dayEl.style.visibility === 'hidden') return;
            openDay(dayEl);
        });
    }

    const searchInput = document.getElementById('search-box');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(filterEntries, 120));
    }
    
    sortableInstance = new Sortable(document.getElementById('tag-container'), {
        animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost',
        onEnd: function () {
            let newOrder = []; document.querySelectorAll('.tag-pill').forEach(pill => { newOrder.push(pill.dataset.tagName); });
            csrfFetch('/reorder_tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: newOrder }) })
            .then(r => r.json()).then(data => { if(data.status === 'success') { ENV.tagsData = data.tags_data; renderTags(); applyColors(); } });
        }
    });

    document.getElementById('f-add-tag').onsubmit = function(e) {
        e.preventDefault();
        const inputEl = document.getElementById('new-tag-name');
        const normalized = inputEl.value.replace(/,/g, '').trim();

        if (!normalized) {
            alert('Tag name is required.');
            inputEl.focus();
            return;
        }

        if (normalized.length > TAG_NAME_MAX_LEN) {
            alert(`Tag name must be ${TAG_NAME_MAX_LEN} characters or fewer.`);
            inputEl.focus();
            return;
        }

        if (normalized.includes('\u0000')) {
            alert('Tag name contains invalid characters.');
            inputEl.focus();
            return;
        }

        const fd = new FormData();
        fd.append('name', normalized);
        csrfFetch('/add_tag', { method: 'POST', body: fd }).then(r => r.json()).then(data => {
            if(data.status === 'success') { ENV.tagsData = data.tags_data; renderTags(); applyColors(); document.getElementById('new-tag-name').value = ''; } else { alert(data.error); }
        });
    };

    document.getElementById('f-update').onsubmit = function(e) {
        e.preventDefault(); const fd = new FormData(this); const markdownText = mde.value().trim(); const targetDate = document.getElementById('i-date').value;
        
        fd.set('blog_text', markdownText); if (markdownText.length > 0) { fd.set('has_blog', '1'); }
        fd.set('tags', Array.from(document.querySelectorAll('input[name="tags"]:checked')).map(cb => cb.value).join(','));

        csrfFetch('/update', { method: 'POST', body: fd }).then(r => r.json()).then(data => {
            if(data.status === 'success') {
                activeEl.className = `day ${activeEl.classList.contains('is-today')?'is-today':''} ${markdownText.length > 0 ? 'has-blog' : ''}`;
                activeEl.dataset.tags = data.new_tags; activeEl.dataset.blog = data.has_blog; activeEl.dataset.snapshot = data.snapshot; 
                
                if (!ENV.logsData[targetDate]) ENV.logsData[targetDate] = {main: '', footnotes: ''};
                ENV.logsData[targetDate].main = markdownText;
                
                applyColors(); closeEditor();
            } else { alert(data.error); }
        });
    };

    document.getElementById('f-footnote').onsubmit = function(e) {
        e.preventDefault();
        const fd = new FormData();
        const text = fnMde.value().trim();
        const targetDate = document.getElementById('fn-date').value;
        
        fd.append('date', targetDate);
        fd.append('footnotes', text);

        csrfFetch('/update_footnote', { method: 'POST', body: fd }).then(r => r.json()).then(data => {
            if(data.status === 'success') {
                if (!ENV.logsData[targetDate]) ENV.logsData[targetDate] = {main: '', footnotes: ''};
                ENV.logsData[targetDate].footnotes = text;
                closeFootnoteModal();
                renderJournal(); 
            }
        });
    };
});

window.loadMonth = function(year, month) {
    closeEditor(); 
    csrfFetch(`/api/calendar?year=${year}&month=${month}`).then(r => r.json()).then(data => {
        document.getElementById('month-title').innerText = `${data.month_name} ${data.year}`;
        ENV.prevYear = data.prev_year; ENV.prevMonth = data.prev_month; ENV.nextYear = data.next_year; ENV.nextMonth = data.next_month;
        let html = '';
        data.cal_data.forEach(week => {
            week.forEach(d => {
                if (!d) { html += '<div class="day" style="visibility:hidden"></div>'; } else {
                    let classes = `day ${d.is_today ? 'is-today' : ''} ${d.has_blog ? 'has-blog' : ''}`;
                    let safeSnapshot = d.snapshot ? escapeHtml(d.snapshot) : '{}';
                    let safeDate = escapeHtml(d.date);
                    let safeTags = escapeHtml(d.tags);
                    let safeStatus = escapeHtml(d.status);
                    let safeDay = escapeHtml(String(d.day));
                    html += `<div class="${classes}" data-date="${safeDate}" data-tags="${safeTags}" data-snapshot="${safeSnapshot}" data-blog="${d.has_blog}" data-locked="${d.is_locked ? '1' : '0'}" data-status="${safeStatus}"><div class="cell-paper"></div><span class="cell-content">${safeDay}</span></div>`;
                }
            });
        });
        const grid = document.getElementById('calendar'); grid.style.opacity = '0';
        setTimeout(() => { grid.innerHTML = html; applyColors(); grid.style.opacity = '1'; }, 150);
    });
}

window.openDay = function(el) {
    activeEl = el; const targetDate = el.dataset.date;
    document.getElementById('editor').style.display = 'block'; document.getElementById('ed-date').innerText = targetDate;
    document.getElementById('i-date').value = targetDate; document.getElementById('status-bar').innerText = el.dataset.status;
    
    if (!mde) mde = new EasyMDE({ element: document.getElementById('i-text'), spellChecker: false, status: false });
    
    let logObj = ENV.logsData[targetDate] || {main: ''};
    mde.value(logObj.main);
    
    const isLocked = el.dataset.locked === '1';
    document.getElementById('s-btn').disabled = isLocked; mde.codemirror.setOption("readOnly", isLocked);
    renderTags(); sortableInstance.option("disabled", isLocked);
    setTimeout(() => { document.querySelector('#view-tracker').scrollTo({ top: document.getElementById('editor').offsetTop, behavior: 'smooth' }); }, 100);
}

window.deleteTag = function(tagName) {
    if(!confirm(`Archive '${tagName}'? Historical entries keep their color, but it will be removed from the menu.`)) return;
    const fd = new FormData(); fd.append('name', tagName);
    csrfFetch('/delete_tag', { method: 'POST', body: fd }).then(r => r.json()).then(data => { if(data.status === 'success') { ENV.tagsData = data.tags_data; renderTags(); applyColors(); } });
};

window.renderJournal = function() {
    const container = document.getElementById('entries-container'); container.innerHTML = '';
    const validDates = Object.keys(ENV.logsData).sort((a,b) => b.localeCompare(a));
    
    if(validDates.length === 0) { container.innerHTML = "<h3 style='text-align:center;'>No entries yet.</h3>"; return; }

    validDates.forEach((date) => {
        let logObj = ENV.logsData[date];
        let rawMain = logObj.main || '';
        let rawFootnotes = logObj.footnotes || '';
        
        if (rawMain.trim() === '' && rawFootnotes.trim() === '') return;

        const lines = rawMain.split('\n');
        let titleIndex = lines.findIndex(l => l.trim().length > 0);
        const [y, m, d] = date.split('-'); const localDate = new Date(y, m-1, d);
        const dateStr = localDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        
        let title = "Entry " + date;
        let remainingText = rawMain;

        if (titleIndex !== -1) {
            title = lines[titleIndex].replace(/^#+\s*/, '').trim();
            lines.splice(titleIndex, 1); remainingText = lines.join('\n').trim();
        }

        const safeTitle = escapeHtml(title);

        const div = document.createElement('div'); div.className = 'entry';
        div.dataset.searchtext = (title + " " + remainingText + " " + rawFootnotes + " " + dateStr).toLowerCase();
        
        let html = `
            <div class="entry-header">
                <div class="entry-date">${dateStr}</div>
                <button class="btn-add-footnote" onclick="openFootnoteModal('${date}')" title="Add or edit infinite footnotes">&#10000; Footnotes</button>
            </div>
            <button class="entry-title" onclick="toggleEntry(this)">${safeTitle}</button>
            <div class="entry-content" style="display: ${allExpanded ? 'block' : 'none'}; opacity: ${allExpanded ? '1' : '0'}; transition: opacity 0.3s;">
                <div class="main-text">${sanitizeHtml(marked.parse(remainingText, { breaks: true }))}</div>
        `;
        
        if (rawFootnotes.trim() !== '') {
            html += `
                <div class="footnote-block">
                    <div class="footnote-block-title">Chronicle Addendum</div>
                    ${sanitizeHtml(marked.parse(rawFootnotes, { breaks: true }))}
                </div>
            `;
        }
        
        html += `</div>`;
        div.innerHTML = html;
        container.appendChild(div);
    });
    filterEntries(); 
}

window.openFootnoteModal = function(date) {
    const overlay = document.getElementById('footnote-overlay');
    overlay.style.display = 'flex';
    
    document.getElementById('fn-display-date').innerText = "Addendum for: " + date;
    document.getElementById('fn-date').value = date;
    
    if (!fnMde) { fnMde = new EasyMDE({ element: document.getElementById('fn-text'), spellChecker: false, status: false, maxHeight: '200px' }); }
    
    let existingText = (ENV.logsData[date] && ENV.logsData[date].footnotes) ? ENV.logsData[date].footnotes : "";
    fnMde.value(existingText);
    
    setTimeout(() => { fnMde.codemirror.refresh(); }, 50);
}

window.closeFootnoteModal = function() { document.getElementById('footnote-overlay').style.display = 'none'; }
document.getElementById('footnote-overlay').addEventListener('click', function(e) { if (e.target === this) closeFootnoteModal(); });

window.toggleEntry = function(btn) {
    const c = btn.nextElementSibling;
    if (c.style.display === 'block') { c.style.opacity = '0'; setTimeout(() => c.style.display = 'none', 300); } 
    else { c.style.display = 'block'; setTimeout(() => c.style.opacity = '1', 10); }
}

window.filterEntries = function() {
    const searchBox = document.getElementById('search-box');
    if (!searchBox) return;
    const query = searchBox.value.toLowerCase();
    document.querySelectorAll('.entry').forEach(entry => { entry.style.display = entry.dataset.searchtext.includes(query) ? 'block' : 'none'; });
}

window.toggleAll = function() {
    allExpanded = !allExpanded;
    document.querySelectorAll('.entry-content').forEach(c => { 
        if (allExpanded) { c.style.display = 'block'; setTimeout(() => c.style.opacity = '1', 10); } 
        else { c.style.opacity = '0'; setTimeout(() => c.style.display = 'none', 300); }
    });
    document.getElementById('btn-expand').innerText = allExpanded ? "Collapse All" : "Expand All";
}