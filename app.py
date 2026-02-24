from flask import Flask, render_template, request, redirect, url_for, session
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
import os
from datetime import datetime
import calendar
import json
import colorsys
import re
import secrets

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-only-secret-key-change-me')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('SESSION_COOKIE_SECURE', '0') == '1'
TRACKER_START_DATE = '2026-02-22'
HEX_COLOR_RE = re.compile(r'^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
MAX_TAG_NAME_LEN = 60

def get_csrf_token():
    token = session.get('_csrf_token')
    if not token:
        token = secrets.token_urlsafe(32)
        session['_csrf_token'] = token
    return token

@app.context_processor
def inject_csrf_token():
    return {'csrf_token': get_csrf_token}

@app.before_request
def csrf_protect():
    if request.method not in ('POST', 'PUT', 'PATCH', 'DELETE'):
        return None

    session_token = session.get('_csrf_token')
    req_token = request.headers.get('X-CSRF-Token') or request.form.get('csrf_token')
    if not req_token and request.is_json:
        payload = request.get_json(silent=True) or {}
        req_token = payload.get('csrf_token')

    if not session_token or not req_token or not secrets.compare_digest(session_token, req_token):
        return {"error": "Invalid CSRF token."}, 400
    return None

def normalize_hex_color(value):
    if not value:
        return None
    cleaned = value.strip()
    if not HEX_COLOR_RE.match(cleaned):
        return None
    cleaned = cleaned.lstrip('#')
    if len(cleaned) == 3:
        cleaned = ''.join([ch * 2 for ch in cleaned])
    return f"#{cleaned.upper()}"

def sanitize_tag_name(value):
    if value is None:
        return None
    name = value.replace(',', '').strip()
    if not name or len(name) > MAX_TAG_NAME_LEN or '\x00' in name:
        return None
    return name

def get_lock_status(date_str, today_str):
    if date_str < TRACKER_START_DATE:
        return True, "Sealed"
    if date_str > today_str:
        return True, "Future"
    if date_str == today_str:
        return False, "Active"
    return True, "Archived"

def _append_hls_colors(colors, hues, lightness, saturation):
    for h in hues:
        rgb = colorsys.hls_to_rgb(h, lightness, saturation)
        colors.append('#%02x%02x%02x' % tuple(int(x * 255) for x in rgb))

def generate_tiered_pastels():
    colors = []
    hues = [(i * 0.618033988749895) % 1.0 for i in range(43)]
    _append_hls_colors(colors, hues, 0.75, 0.85)
    _append_hls_colors(colors, hues, 0.85, 0.65)
    _append_hls_colors(colors, hues, 0.93, 0.45)
    return colors[:128]

HARMONIOUS_COLORS = generate_tiered_pastels()

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row 
    return conn

def assign_permanent_colors(conn, user_id=None):
    tags = conn.execute('SELECT id, color FROM tags WHERE user_id = ? ORDER BY id ASC', (user_id,)).fetchall() if user_id else conn.execute('SELECT id, color FROM tags ORDER BY id ASC').fetchall()
    for tag_row in tags:
        if not tag_row['color']:
            conn.execute('UPDATE tags SET color = ? WHERE id = ?', (HARMONIOUS_COLORS[(tag_row['id'] - 1) % len(HARMONIOUS_COLORS)], tag_row['id']))
    conn.commit()

def get_tags_data(conn, user_id):
    return {t['name']: {'color': t['color'], 'priority': t['priority']} for t in conn.execute('SELECT * FROM tags WHERE user_id = ? AND active=1 ORDER BY priority DESC', (user_id,)).fetchall()}

def init_db():
    conn = get_db_connection()
    conn.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS logs (user_id INTEGER, date TEXT, score INTEGER, has_blog INTEGER, blog_text TEXT, edit_count INTEGER DEFAULT 0, tags TEXT DEFAULT '', tags_snapshot TEXT DEFAULT '{}', PRIMARY KEY (user_id, date))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, color TEXT, priority INTEGER, active INTEGER DEFAULT 1, UNIQUE(user_id, name))''')
    
    # Safely add the new footnotes column if it doesn't exist
    try: conn.execute("ALTER TABLE logs ADD COLUMN footnotes TEXT DEFAULT ''")
    except sqlite3.OperationalError: pass
    
    assign_permanent_colors(conn)
    conn.commit()
    conn.close()

init_db()

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = get_db_connection().execute('SELECT * FROM users WHERE username = ?', (request.form['username'],)).fetchone()
        if user and check_password_hash(user['password'], request.form['password']):
            session['user_id'] = user['id']
            return redirect(url_for('tracker'))
        return render_template('auth.html', action='login', error='Invalid credentials.')
    return render_template('auth.html', action='login')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        conn = get_db_connection()
        try:
            conn.execute('INSERT INTO users (username, password) VALUES (?, ?)', (request.form['username'], generate_password_hash(request.form['password'])))
            conn.commit()
            user_id = conn.execute('SELECT id FROM users WHERE username = ?', (request.form['username'],)).fetchone()['id']
            conn.executemany('INSERT INTO tags (user_id, name, color, priority, active) VALUES (?, ?, ?, ?, ?)', [(user_id, 'Study', '', 10, 1), (user_id, 'Sleep', '', 8, 1), (user_id, 'Hobby', '', 5, 1)])
            assign_permanent_colors(conn, user_id)
            conn.close()
            return redirect(url_for('login'))
        except sqlite3.IntegrityError: return render_template('auth.html', action='register', error='Username already exists.')
    return render_template('auth.html', action='register')

@app.route('/change_credentials', methods=['GET', 'POST'])
def change_credentials():
    if 'user_id' not in session: return redirect(url_for('login'))
    if request.method == 'POST':
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE id = ?', (session['user_id'],)).fetchone()
        if user and user['username'] == request.form['old_username'] and check_password_hash(user['password'], request.form['old_password']):
            try:
                conn.execute('UPDATE users SET username = ?, password = ? WHERE id = ?', (request.form['new_username'], generate_password_hash(request.form['new_password']), session['user_id']))
                conn.commit(); conn.close()
                return redirect(url_for('tracker'))
            except sqlite3.IntegrityError: return render_template('auth.html', action='change', error='New username already taken.')
        return render_template('auth.html', action='change', error='Old credentials incorrect.')
    return render_template('auth.html', action='change')

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    return redirect(url_for('login'))

@app.route('/')
def tracker():
    if 'user_id' not in session: return redirect(url_for('login'))
    user_id, today = session['user_id'], datetime.today()
    year, month = request.args.get('year', today.year, int), request.args.get('month', today.month, int)
    today_str = today.strftime('%Y-%m-%d')

    conn = get_db_connection()
    logs = conn.execute('SELECT * FROM logs WHERE user_id = ?', (user_id,)).fetchall()
    tags_data = get_tags_data(conn, user_id)
    conn.close()

    # We convert sqlite3.Row into standard dictionaries here
    log_dict = {l['date']: dict(l) for l in logs}
    cal_data = []
    
    for week in calendar.monthcalendar(year, month):
        week_data = []
        for d in week:
            if d == 0: week_data.append(None)
            else:
                date_str = f"{year}-{month:02d}-{d:02d}"
                log = log_dict.get(date_str, {'tags': '', 'has_blog': 0, 'tags_snapshot': '{}'})
                is_today = (date_str == today_str)

                locked, status = get_lock_status(date_str, today_str)

                week_data.append({'day': d, 'date': date_str, 'tags': log['tags'], 'has_blog': log['has_blog'], 'is_locked': locked, 'is_today': is_today, 'status': status, 'snapshot': log.get('tags_snapshot', '{}')})
        cal_data.append(week_data)

    # DUAL PAYLOAD: Now safely iterates over the standard dictionaries (log_dict.values())
    def _has_log_content(log_entry):
        """Return True if the log entry has a blog or non-empty footnotes."""
        has_blog = log_entry.get('has_blog') == 1
        footnotes = log_entry.get('footnotes')
        has_footnotes = bool(footnotes and footnotes.strip())
        return has_blog or has_footnotes

    logs_data = {
        l['date']: {
            'main': l.get('blog_text') or '',
            'footnotes': l.get('footnotes') or ''
        }
        for l in log_dict.values()
        if _has_log_content(l)
    }
    return render_template('tracker.html', cal_data=cal_data, month_name=calendar.month_name[month], year=year, today_str=today_str, logs_data=logs_data, tags_data=tags_data, prev_month=month-1 if month > 1 else 12, prev_year=year if month > 1 else year-1, next_month=month+1 if month < 12 else 1, next_year=year if month < 12 else year+1)

@app.route('/api/calendar')
def api_calendar():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    user_id, today = session['user_id'], datetime.today()
    year, month = request.args.get('year', today.year, int), request.args.get('month', today.month, int)
    today_str = today.strftime('%Y-%m-%d')
    
    conn = get_db_connection()
    logs = conn.execute('SELECT date, tags, has_blog, tags_snapshot FROM logs WHERE user_id = ?', (user_id,)).fetchall()
    conn.close()
    
    log_dict = {l['date']: dict(l) for l in logs}
    cal_data = []
    
    for week in calendar.monthcalendar(year, month):
        week_data = []
        for d in week:
            if d == 0: week_data.append(None)
            else:
                date_str = f"{year}-{month:02d}-{d:02d}"
                log = log_dict.get(date_str, {'tags': '', 'has_blog': 0, 'tags_snapshot': '{}'})
                is_today = (date_str == today_str)

                # Restored the missing lock logic so 'locked' and 'status' are defined
                locked, status = get_lock_status(date_str, today_str)

                week_data.append({'day': d, 'date': date_str, 'tags': log['tags'], 'has_blog': log['has_blog'], 'is_locked': locked, 'is_today': is_today, 'status': status, 'snapshot': log.get('tags_snapshot', '{}')})
        cal_data.append(week_data)
        
    return {"month_name": calendar.month_name[month], "year": year, "prev_month": month-1 if month > 1 else 12, "prev_year": year if month > 1 else year-1, "next_month": month+1 if month < 12 else 1, "next_year": year if month < 12 else year+1, "cal_data": cal_data}

@app.route('/update', methods=['POST'])
def update_day():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    user_id, date, today_str = session['user_id'], request.form['date'], datetime.today().strftime('%Y-%m-%d')
    
    # STRICT LOCK RULE ENFORCEMENT
    if date != today_str: return {"error": "Past entries are strictly sealed. Add a footnote in the Chronicles tab."}, 403

    conn = get_db_connection()
    snapshot_json = json.dumps(get_tags_data(conn, user_id))
    
    conn.execute('''INSERT INTO logs (user_id, date, score, tags, has_blog, blog_text, tags_snapshot) 
                    VALUES (?, ?, 0, ?, ?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET 
                    tags=excluded.tags, has_blog=excluded.has_blog, blog_text=excluded.blog_text, 
                    tags_snapshot=excluded.tags_snapshot''', 
                    (user_id, date, request.form.get('tags', ''), 1 if 'has_blog' in request.form else 0, request.form['blog_text'], snapshot_json))
    conn.commit()
    conn.close()
    return {"status": "success", "new_tags": request.form.get('tags', ''), "has_blog": 1 if 'has_blog' in request.form else 0, "snapshot": snapshot_json}, 200

@app.route('/update_footnote', methods=['POST'])
def update_footnote():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    user_id, date, footnotes = session['user_id'], request.form['date'], request.form['footnotes']
    
    conn = get_db_connection()
    # Bypass all lock rules, strictly updates/inserts the footnote
    conn.execute('''INSERT INTO logs (user_id, date, score, has_blog, footnotes) 
                    VALUES (?, ?, 0, 0, ?) ON CONFLICT(user_id, date) DO UPDATE SET 
                    footnotes=excluded.footnotes''', (user_id, date, footnotes))
    conn.commit()
    conn.close()
    return {"status": "success", "footnotes": footnotes}, 200

@app.route('/add_tag', methods=['POST'])
def add_tag():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    user_id = session['user_id']
    name = sanitize_tag_name(request.form.get('name', ''))
    if not name: return {"error": f"Name required (1-{MAX_TAG_NAME_LEN} chars)."}, 400
    
    conn = get_db_connection()
    min_prio = (conn.execute('SELECT MIN(priority) as m FROM tags WHERE user_id = ? AND active=1', (user_id,)).fetchone()['m'] or 100) - 1
    try: conn.execute('INSERT INTO tags (user_id, name, color, priority, active) VALUES (?, ?, "", ?, 1)', (user_id, name, min_prio))
    except sqlite3.IntegrityError: conn.execute('UPDATE tags SET active=1, priority=? WHERE user_id=? AND name=?', (min_prio, user_id, name))
    conn.commit(); assign_permanent_colors(conn, user_id)
    tags_data = get_tags_data(conn, user_id)
    conn.close()
    return {"status": "success", "tags_data": tags_data}, 200

@app.route('/update_tag_color', methods=['POST'])
def update_tag_color():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    tag_name = sanitize_tag_name(request.form.get('name', ''))
    if not tag_name:
        return {"error": "Invalid tag name."}, 400

    normalized_color = normalize_hex_color(request.form.get('color', ''))
    if not normalized_color:
        return {"error": "Invalid color format. Use #RRGGBB or #RGB."}, 400

    conn = get_db_connection()
    conn.execute('UPDATE tags SET color = ? WHERE user_id = ? AND name = ?', (normalized_color, session['user_id'], tag_name))
    conn.commit(); tags_data = get_tags_data(conn, session['user_id']); conn.close()
    return {"status": "success", "tags_data": tags_data}, 200

@app.route('/reorder_tags', methods=['POST'])
def reorder_tags():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    raw_tags = request.json.get('tags', []) if request.is_json else []
    sanitized_tags = []
    seen = set()
    for raw_name in raw_tags:
        safe_name = sanitize_tag_name(raw_name)
        if safe_name and safe_name not in seen:
            sanitized_tags.append(safe_name)
            seen.add(safe_name)

    conn, max_prio = get_db_connection(), len(sanitized_tags)
    for i, name in enumerate(sanitized_tags):
        conn.execute('UPDATE tags SET priority = ? WHERE user_id = ? AND name = ?', (max_prio - i, session['user_id'], name))
    conn.commit(); tags_data = get_tags_data(conn, session['user_id']); conn.close()
    return {"status": "success", "tags_data": tags_data}

@app.route('/delete_tag', methods=['POST'])
def delete_tag():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    tag_name = sanitize_tag_name(request.form.get('name', ''))
    if not tag_name:
        return {"error": "Invalid tag name."}, 400

    conn = get_db_connection()
    conn.execute('UPDATE tags SET active=0 WHERE user_id = ? AND name = ?', (session['user_id'], tag_name))
    conn.commit(); tags_data = get_tags_data(conn, session['user_id']); conn.close()
    return {"status": "success", "tags_data": tags_data}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=os.environ.get('FLASK_DEBUG', '0') == '1', port=5000)