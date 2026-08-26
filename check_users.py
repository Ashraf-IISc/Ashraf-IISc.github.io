import sqlite3

# Connect to your Grimoire database
conn = sqlite3.connect('database.db', timeout=10)
cursor = conn.cursor()

# Grab all the users
cursor.execute("SELECT id, username, password FROM users")
users = cursor.fetchall()

print("--- GRIMOIRE USERS ---")
for user in users:
    user_id = user[0]
    username = user[1]
    password_hash = user[2]
    
    # We only print the first 30 characters of the hash so it doesn't flood your screen
    print(f"[{user_id}] Username: {username} | Hash: {password_hash[:30]}...")

conn.close()