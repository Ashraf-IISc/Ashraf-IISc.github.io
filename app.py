from flask import Flask, render_template, request, redirect, url_for, session
import sqlite3
from werkzeug.security import check_password_hash
import os
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = os.urandom(24) # Keeps your login session secure

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        conn.close()

        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['id']
            return redirect(url_for('tracker'))
        else:
            error = 'Invalid credentials.'
            
    return render_template('login.html', error=error)

@app.route('/')
def tracker():
    if 'user_id' not in session:
        return redirect(url_for('login'))
        
    conn = get_db_connection()
    logs = conn.execute('SELECT * FROM logs').fetchall()
    conn.close()
    
    # Convert database rows into a dictionary so HTML can read it easily
    log_dict = {log['date']: {'score': log['score'], 'has_blog': log['has_blog'], 'blog_text': log['blog_text']} for log in logs}
    
    # Generate a list of the last 30 days
    today = datetime.today()
    days = [(today - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(29, -1, -1)]
    
    return render_template('tracker.html', days=days, log_dict=log_dict)

@app.route('/update', methods=['POST'])
def update_day():
    if 'user_id' not in session:
        return redirect(url_for('login'))
        
    date = request.form['date']
    score = int(request.form['score'])
    has_blog = 1 if 'has_blog' in request.form else 0
    blog_text = request.form['blog_text']
    
    conn = get_db_connection()
    conn.execute('''
        INSERT INTO logs (date, score, has_blog, blog_text) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET 
        score=excluded.score, has_blog=excluded.has_blog, blog_text=excluded.blog_text
    ''', (date, score, has_blog, blog_text))
    conn.commit()
    conn.close()
    
    return redirect(url_for('tracker'))

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5000)