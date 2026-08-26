let ENV = window.GRIMOIRE_ENV;
let mde = null; 
let fnMde = null;
let activeEl = null;
let sortableInstance = null;
let allExpanded = false;
let activeTagForColor = null;

/**
 * Send a request to the Flask backend and return parsed JSON safely.
 * Network failures, backend disconnects, and non-2xx responses are trapped
 * so the UI can fail gracefully without breaking user flow.
 *
 * @param {string} url - Backend endpoint URL.
 * @param {RequestInit} [options={}] - Fetch options.
 * @param {string} [userMessage='Unable to reach the server right now.'] - Alert message shown on failure.
 * @returns {Promise<Object|null>} Parsed response payload or null when the request fails.
 */
async function safeFetchJson(url, options = {}, userMessage = 'Unable to reach the server right now.') {
    try {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Request failed with status ${response.status}`);
        }

        return data;
    } catch (err) {
        console.error(`Backend request failed for ${url}:`, err);
        if (userMessage) {
            alert(userMessage);
        }
        return null;
    }
}

window.openColorPicker = function(e, tagName) {
    e.preventDefault();
    e.stopPropagation();
    activeTagForColor = tagName;
    populateColorPicker();
    
    let currentColor = ENV.tagsData[tagName].color || '';
    document.getElementById('hex-color-input').value = currentColor.toUpperCase();
    
    const picker = document.getElementById('color-picker');
    picker.style.display = 'block'; 
    
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
        picker.style.transform = 'none'; 
    }
}

window.switchView = function(viewName) {
    const vTracker = document.getElementById('view-tracker');
    const vJournal = document.getElementById('view-journal');
    
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

/**
 * Fill the color picker with random but controlled swatches based on selected
 * hue and intensity tiers.
 *
 * @returns {void}
 */
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

window.selectHexColor = function() { 
    let hex = document.getElementById('hex-color-input').value.trim();
    
    if (hex === '') return;
    
    if (hex.charAt(0) !== '#') {
        hex = '#' + hex;
    }
    
    if (/^#[0-9A-F]{3}$/i.test(hex)) {
        hex = '#' + hex[1]+hex[1] + hex[2]+hex[2] + hex[3]+hex[3];
    }
    
    if (!/^#[0-9A-F]{6}$/i.test(hex)) {
        alert('Please enter a valid hex code (e.g. FF5500 or F50)');
        return;
    }
    
    selectColor(hex); 
    document.getElementById('hex-color-input').value = ''; 
}

async function selectColor(colorHex) {
    const fd = new FormData(); fd.append('name', activeTagForColor); fd.append('color', colorHex);
    const data = await safeFetchJson('/update_tag_color', { method: 'POST', body: fd }, 'Color update failed. Please try again.');
    if (data && data.status === 'success') {
        ENV.tagsData = data.tags_data;
        renderTags();
        applyColors();
        document.getElementById('color-picker').style.display = 'none';
    }
}

document.addEventListener('click', (e) => {
    if(!e.target.closest('#color-picker') && !e.target.closest('.pill-color-bar')) { document.getElementById('color-picker').style.display = 'none'; }
});

// THE FIX: Added the skipSave flag to prevent race conditions during renders
window.togglePill = function(checkbox, skipSave = false) {
    const pill = checkbox.closest('.tag-pill');
    if(checkbox.checked) pill.classList.add('active-pill'); else pill.classList.remove('active-pill');
    
    // Only fire the instant background save if it was a human click (!skipSave)
    if (!skipSave && activeEl && activeEl.dataset.locked !== '1') {
        const targetDate = document.getElementById('i-date').value;
        const activeTags = Array.from(document.querySelectorAll('input[name="tags"]:checked')).map(cb => cb.value).join(',');
        
        const fd = new FormData();
        fd.append('date', targetDate); fd.append('tags', activeTags);
        
        (async () => {
            const data = await safeFetchJson('/update_day_tags', { method: 'POST', body: fd }, 'Could not save tags. The server may be offline.');
            if (data && data.status === 'success') {
                activeEl.dataset.tags = data.new_tags;
                activeEl.dataset.snapshot = data.snapshot;
                applyColors();
            }
        })();
    }
};

window.closeEditor = function() { document.getElementById('editor').style.display = 'none'; activeEl = null; };

function renderTags() {
    const container = document.getElementById('tag-container'); container.innerHTML = '';
    const sortedTags = Object.keys(ENV.tagsData).sort((a, b) => ENV.tagsData[b].priority - ENV.tagsData[a].priority);
    const isLocked = activeEl && activeEl.dataset.locked === '1';

    sortedTags.forEach(tagName => {
        const tag = ENV.tagsData[tagName];
        const pill = document.createElement('div'); pill.className = 'tag-pill'; pill.dataset.tagName = tagName;
        pill.innerHTML = `
            <label>
                <input type="checkbox" name="tags" value="${tagName}" onchange="togglePill(this)" ${isLocked ? 'disabled' : ''}> 
                <span title="${tagName}">${tagName}</span>
                <div class="pill-color-bar" style="background-color: ${tag.color};" onclick="openColorPicker(event, '${tagName}')" title="Tap to change color"></div>
            </label>
            <button type="button" class="tag-del-btn" onclick="deleteTag('${tagName}')" style="display: ${isLocked ? 'none' : 'block'}">&times;</button>
        `;
        container.appendChild(pill);
    });
    
    if (activeEl) {
        const activeTags = activeEl.dataset.tags ? activeEl.dataset.tags.split(',') : [];
        document.querySelectorAll('input[name="tags"]').forEach(cb => { 
            cb.checked = activeTags.includes(cb.value); 
            // THE FIX: Pass true so the computer drawing the tags doesn't trigger 10 instant saves
            togglePill(cb, true); 
        });
    }
}

/**
 * Paint each calendar cell with stacked gradients proportional to tag priority.
 * Historical days use their stored tag snapshot so visual weights remain stable
 * even if current tag priorities/colors later change.
 *
 * @returns {void}
 */
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
        let minPct = 12; let usablePct = 100 - (N * minPct); if (usablePct < 0) { minPct = 100 / N; usablePct = 0; }
        let globalTotalWeight = allUniverseNames.reduce((sum, name) => sum + Math.pow(sizeUniverse[name].priority, 1.5), 0);

        let tagSizes = {};
        allUniverseNames.forEach(name => { let weight = Math.pow(sizeUniverse[name].priority, 1.5); tagSizes[name] = minPct + ((globalTotalWeight > 0 ? (weight / globalTotalWeight) : 0) * usablePct); });

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

    /**
     * Drag-and-drop ordering for tag pills.
     * Sortable updates the visual sequence immediately, then persists the new
     * order to Flask. Backend priority values are recalculated from top to
     * bottom so future renders preserve the dragged order.
     */
    sortableInstance = new Sortable(document.getElementById('tag-container'), {
        animation: 250, 
        filter: '.tag-del-btn', 
        preventOnFilter: false, 
        ghostClass: 'sortable-ghost',
        delay: 150,
        delayOnTouchOnly: true,
        onEnd: async function () {
            let newOrder = []; document.querySelectorAll('.tag-pill').forEach(pill => { newOrder.push(pill.dataset.tagName); });
            const data = await safeFetchJson('/reorder_tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: newOrder }) }, 'Reordering tags failed. Please retry.');
            if (data && data.status === 'success') {
                ENV.tagsData = data.tags_data;
                renderTags();
                applyColors();
            }
        }
    });

    document.getElementById('f-add-tag').onsubmit = async function(e) {
        e.preventDefault(); const fd = new FormData(); fd.append('name', document.getElementById('new-tag-name').value);
        const data = await safeFetchJson('/add_tag', { method: 'POST', body: fd }, 'Unable to add tag. Please check server connection.');
        if (!data) return;
        if (data.status === 'success') {
            ENV.tagsData = data.tags_data;
            renderTags();
            applyColors();
            document.getElementById('new-tag-name').value = '';
        } else {
            alert(data.error);
        }
    };

    document.getElementById('f-update').onsubmit = async function(e) {
        e.preventDefault(); const fd = new FormData(this); const markdownText = mde.value().trim(); const targetDate = document.getElementById('i-date').value;
        
        fd.set('blog_text', markdownText); let isBlog = false; if (markdownText.length > 0) { fd.set('has_blog', '1'); isBlog = true; }
        fd.set('tags', Array.from(document.querySelectorAll('input[name="tags"]:checked')).map(cb => cb.value).join(','));

        const data = await safeFetchJson('/update', { method: 'POST', body: fd }, 'Saving entry failed. The backend may be disconnected.');
        if (!data) return;
        if (data.status === 'success') {
            activeEl.className = `day ${activeEl.classList.contains('is-today')?'is-today':''} ${isBlog ? 'has-blog' : ''}`;
            activeEl.dataset.tags = data.new_tags; activeEl.dataset.blog = data.has_blog; activeEl.dataset.snapshot = data.snapshot;

            if (!ENV.logsData[targetDate]) ENV.logsData[targetDate] = {main: '', footnotes: ''};
            ENV.logsData[targetDate].main = markdownText;

            applyColors(); closeEditor();
        } else { alert(data.error); }
    };

    document.getElementById('f-footnote').onsubmit = async function(e) {
        e.preventDefault();
        const fd = new FormData();
        const text = fnMde.value().trim();
        const targetDate = document.getElementById('fn-date').value;
        
        fd.append('date', targetDate);
        fd.append('footnotes', text);

        const data = await safeFetchJson('/update_footnote', { method: 'POST', body: fd }, 'Saving footnotes failed. Please retry.');
        if (data && data.status === 'success') {
            if (!ENV.logsData[targetDate]) ENV.logsData[targetDate] = {main: '', footnotes: ''};
            ENV.logsData[targetDate].footnotes = text;
            closeFootnoteModal();
            renderJournal();
        }
    };
});

window.loadMonth = async function(year, month) {
    closeEditor(); 
    const data = await safeFetchJson(`/api/calendar?year=${year}&month=${month}`, {}, 'Calendar load failed. Server is unavailable.');
    if (!data) return;
    document.getElementById('month-title').innerText = `${data.month_name} ${data.year}`;
    ENV.prevYear = data.prev_year; ENV.prevMonth = data.prev_month; ENV.nextYear = data.next_year; ENV.nextMonth = data.next_month;
    let html = '';
    data.cal_data.forEach(week => {
        week.forEach(d => {
            if (!d) { html += '<div class="day" style="visibility:hidden"></div>'; } else {
                let classes = `day ${d.is_today ? 'is-today' : ''} ${d.has_blog ? 'has-blog' : ''}`;
                let safeSnapshot = d.snapshot ? d.snapshot.replace(/"/g, '&quot;') : '{}';
                html += `<div class="${classes}" data-date="${d.date}" data-tags="${d.tags}" data-snapshot="${safeSnapshot}" data-blog="${d.has_blog}" data-locked="${d.is_locked ? '1' : '0'}" data-status="${d.status}" onclick="openDay(this)"><div class="cell-paper"></div><span class="cell-content">${d.day}</span></div>`;
            }
        });
    });
    const grid = document.getElementById('calendar'); grid.style.opacity = '0';
    setTimeout(() => { grid.innerHTML = html; applyColors(); grid.style.opacity = '1'; }, 150);
}

window.openDay = function(el) {
    activeEl = el; const targetDate = el.dataset.date;
    document.getElementById('editor').style.display = 'block'; document.getElementById('ed-date').innerText = targetDate;
    document.getElementById('i-date').value = targetDate; document.getElementById('status-bar').innerText = el.dataset.status;
    
    if (!mde) mde = new EasyMDE({ element: document.getElementById('i-text'), spellChecker: false, status: false });
    
    let logObj = ENV.logsData[targetDate] || {main: ''};
    mde.value(logObj.main);
    
    setTimeout(() => { mde.codemirror.refresh(); }, 50);
    
    const isLocked = el.dataset.locked === '1';
    document.getElementById('s-btn').disabled = isLocked; mde.codemirror.setOption("readOnly", isLocked);
    renderTags(); sortableInstance.option("disabled", isLocked);
    setTimeout(() => { document.querySelector('#view-tracker').scrollTo({ top: document.getElementById('editor').offsetTop, behavior: 'smooth' }); }, 100);
}

window.deleteTag = async function(tagName) {
    if(!confirm(`Archive '${tagName}'? Historical entries keep their color, but it will be removed from the menu.`)) return;
    const fd = new FormData(); fd.append('name', tagName);
    const data = await safeFetchJson('/delete_tag', { method: 'POST', body: fd }, 'Tag archive failed. Please check server connection.');
    if (data && data.status === 'success') {
        ENV.tagsData = data.tags_data;
        renderTags();
        applyColors();
    }
};

/**
 * Build the journal list from cached daily logs.
 * The first non-empty Markdown line is promoted as the entry title, then
 * the remaining body and optional footnotes are rendered to HTML via marked.
 *
 * @returns {void}
 */
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

        const div = document.createElement('div'); div.className = 'entry';
        div.dataset.searchtext = (title + " " + remainingText + " " + rawFootnotes + " " + dateStr).toLowerCase();
        
        let html = `
            <div class="entry-header">
                <div class="entry-date">${dateStr}</div>
                <button class="btn-add-footnote" onclick="openFootnoteModal('${date}')" title="Add or edit infinite footnotes">&#10000; Footnotes</button>
            </div>
            <button class="entry-title" onclick="toggleEntry(this)">${title}</button>
            <div class="entry-content" style="display: ${allExpanded ? 'block' : 'none'}; opacity: ${allExpanded ? '1' : '0'}; transition: opacity 0.3s;">
                <div class="main-text">${marked.parse(remainingText, { breaks: true })}</div>
        `;
        
        if (rawFootnotes.trim() !== '') {
            html += `
                <div class="footnote-block">
                    <div class="footnote-block-title">Chronicle Addendum</div>
                    ${marked.parse(rawFootnotes, { breaks: true })}
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
    const query = document.getElementById('search-box').value.toLowerCase();
    document.querySelectorAll('.entry').forEach(entry => { entry.style.display = entry.dataset.searchtext.includes(query) ? 'block' : 'none'; });
}

/**
 * Expand or collapse all journal entries in one action.
 *
 * @returns {void}
 */
window.toggleAll = function() {
    allExpanded = !allExpanded;
    document.querySelectorAll('.entry-content').forEach(c => { 
        if (allExpanded) { c.style.display = 'block'; setTimeout(() => c.style.opacity = '1', 10); } 
        else { c.style.opacity = '0'; setTimeout(() => c.style.display = 'none', 300); }
    });
    document.getElementById('btn-expand').innerText = allExpanded ? "Collapse All" : "Expand All";
}