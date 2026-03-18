from flask import Flask, render_template, request, redirect, url_for, session
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash
import os
from datetime import datetime
import calendar
import json
import colorsys
import threading
import subprocess
import requests
import re
import atexit

app = Flask(__name__)
app.secret_key = 'the_grimoire_master_key_2026'
TRACKER_START_DATE = '2026-02-22'

def generate_tiered_pastels():
    colors = []
    hues = [(i * 0.618033988749895) % 1.0 for i in range(43)]
    for h in hues: colors.append('#%02x%02x%02x' % tuple(int(x*255) for x in colorsys.hls_to_rgb(h, 0.75, 0.85)))
    for h in hues: colors.append('#%02x%02x%02x' % tuple(int(x*255) for x in colorsys.hls_to_rgb(h, 0.85, 0.65)))
    for h in hues: colors.append('#%02x%02x%02x' % tuple(int(x*255) for x in colorsys.hls_to_rgb(h, 0.93, 0.45)))
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

                if date_str < TRACKER_START_DATE: locked, status = True, "Sealed"
                elif date_str > today_str: locked, status = True, "Future"
                elif is_today: locked, status = False, "Active"
                else: locked, status = True, "Archived"

                week_data.append({'day': d, 'date': date_str, 'tags': log['tags'], 'has_blog': log['has_blog'], 'is_locked': locked, 'is_today': is_today, 'status': status, 'snapshot': log.get('tags_snapshot', '{}')})
        cal_data.append(week_data)

    logs_data = {l['date']: {'main': l['blog_text'] or '', 'footnotes': l.get('footnotes') or ''} for l in log_dict.values() if l.get('blog_text') or l.get('footnotes')}

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

                if date_str < TRACKER_START_DATE: locked, status = True, "Sealed"
                elif date_str > today_str: locked, status = True, "Future"
                elif is_today: locked, status = False, "Active"
                else: locked, status = True, "Archived"

                week_data.append({'day': d, 'date': date_str, 'tags': log['tags'], 'has_blog': log['has_blog'], 'is_locked': locked, 'is_today': is_today, 'status': status, 'snapshot': log.get('tags_snapshot', '{}')})
        cal_data.append(week_data)
        
    return {"month_name": calendar.month_name[month], "year": year, "prev_month": month-1 if month > 1 else 12, "prev_year": year if month > 1 else year-1, "next_month": month+1 if month < 12 else 1, "next_year": year if month < 12 else year+1, "cal_data": cal_data}

@app.route('/update', methods=['POST'])
def update_day():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    user_id, date, today_str = session['user_id'], request.form['date'], datetime.today().strftime('%Y-%m-%d')
    
    if date != today_str: return {"error": "Past entries are strictly sealed."}, 403

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

@app.route('/update_day_tags', methods=['POST'])
def update_day_tags():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    user_id, date, today_str = session['user_id'], request.form['date'], datetime.today().strftime('%Y-%m-%d')
    
    if date != today_str: return {"error": "Past entries are strictly sealed."}, 403

    conn = get_db_connection()
    snapshot_json = json.dumps(get_tags_data(conn, user_id))
    
    existing = conn.execute('SELECT blog_text, has_blog FROM logs WHERE user_id=? AND date=?', (user_id, date)).fetchone()
    b_text = existing['blog_text'] if existing else ''
    h_blog = existing['has_blog'] if existing else 0
    
    conn.execute('''INSERT INTO logs (user_id, date, score, tags, has_blog, blog_text, tags_snapshot) 
                    VALUES (?, ?, 0, ?, ?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET 
                    tags=excluded.tags, tags_snapshot=excluded.tags_snapshot''', 
                    (user_id, date, request.form.get('tags', ''), h_blog, b_text, snapshot_json))
    conn.commit()
    conn.close()
    return {"status": "success", "new_tags": request.form.get('tags', ''), "snapshot": snapshot_json}, 200

@app.route('/update_footnote', methods=['POST'])
def update_footnote():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    user_id, date, footnotes = session['user_id'], request.form['date'], request.form['footnotes']
    
    conn = get_db_connection()
    conn.execute('''INSERT INTO logs (user_id, date, score, has_blog, footnotes) 
                    VALUES (?, ?, 0, 0, ?) ON CONFLICT(user_id, date) DO UPDATE SET 
                    footnotes=excluded.footnotes''', (user_id, date, footnotes))
    conn.commit()
    conn.close()
    return {"status": "success", "footnotes": footnotes}, 200

@app.route('/add_tag', methods=['POST'])
def add_tag():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    user_id, name = session['user_id'], request.form['name'].replace(',', '').strip()
    if not name: return {"error": "Name required"}, 400
    
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
    conn = get_db_connection()
    conn.execute('UPDATE tags SET color = ? WHERE user_id = ? AND name = ?', (request.form['color'], session['user_id'], request.form['name']))
    conn.commit(); tags_data = get_tags_data(conn, session['user_id']); conn.close()
    return {"status": "success", "tags_data": tags_data}, 200

@app.route('/reorder_tags', methods=['POST'])
def reorder_tags():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    conn, max_prio = get_db_connection(), len(request.json.get('tags', []))
    for i, name in enumerate(request.json.get('tags', [])): conn.execute('UPDATE tags SET priority = ? WHERE user_id = ? AND name = ?', (max_prio - i, session['user_id'], name))
    conn.commit(); tags_data = get_tags_data(conn, session['user_id']); conn.close()
    return {"status": "success", "tags_data": tags_data}

@app.route('/delete_tag', methods=['POST'])
def delete_tag():
    if 'user_id' not in session: return {"error": "Unauthorized"}, 401
    conn = get_db_connection()
    conn.execute('UPDATE tags SET active=0 WHERE user_id = ? AND name = ?', (session['user_id'], request.form['name']))
    conn.commit(); tags_data = get_tags_data(conn, session['user_id']); conn.close()
    return {"status": "success", "tags_data": tags_data}, 200

# --- THE DEAD DROP ENGINE ---
try:
    with open('token.txt', 'r') as f:
        GITHUB_TOKEN = f.read().strip()
except FileNotFoundError:
    GITHUB_TOKEN = "UNSET"

GIST_ID = 'a6434fc786ab4ff847dbd09b35588ec4'

def kill_zombie_tunnels():
    """Ensures no orphaned Cloudflare processes are hogging the port."""
    os.system('taskkill /f /im cloudflared-windows-amd64.exe >nul 2>&1')

def update_dead_drop(live_url):
    """Pushes the new Cloudflare URL to the GitHub Gist."""
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    data = {
        "files": {
            "grimoire_url.json": {
                "content": f'{{"url": "{live_url}"}}'
            }
        }
    }
    resp = requests.patch(f'https://api.github.com/gists/{GIST_ID}', headers=headers, json=data)
    if resp.status_code == 200:
        print(f"\n[+] Dead Drop updated securely: {live_url}")
    else:
        print(f"\n[-] Dead Drop update failed: {resp.text}")

def spawn_tunnel():
    """Runs Cloudflare in the background and intercepts the URL."""
    kill_zombie_tunnels()
    
    cmd = ['cloudflared-windows-amd64.exe', 'tunnel', '--url', 'http://127.0.0.1:5000']
    
    # Cloudflare dumps its connection links into stderr, not stdout
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    
    for line in process.stdout:
        match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
        if match:
            live_url = match.group(0)
            update_dead_drop(live_url)
            break # We found it, stop reading output

# Register the kill switch so Windows cleans up when Flask shuts down
atexit.register(kill_zombie_tunnels)
# ----------------------------

if __name__ == '__main__':
    # Prevent the Flask reloader from double-booting the tunnel
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        threading.Thread(target=spawn_tunnel, daemon=True).start()
        
    app.run(host='0.0.0.0', debug=True, port=5000)