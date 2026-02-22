import sqlite3
from werkzeug.security import generate_password_hash

connection = sqlite3.connect('database.db')
cursor = connection.cursor()

# Create the tables
cursor.executescript('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logs (
        date TEXT PRIMARY KEY,
        score INTEGER NOT NULL,
        has_blog BOOLEAN NOT NULL DEFAULT 0,
        blog_text TEXT
    );
''')

# Create your login account
hashed_pw = generate_password_hash('1234')
try:
    cursor.execute("INSERT INTO users (username, password) VALUES (?, ?)", ('ayan', hashed_pw))
except sqlite3.IntegrityError:
    pass # User already exists

connection.commit()
connection.close()
print("Database initialized successfully.")