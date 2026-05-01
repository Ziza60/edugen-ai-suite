import os
import subprocess
import json

def get_tables():
    cmd = ["psql", "-X", "-t", "-c", "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT IN ('ai_cache', 'usage_events');"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return [t.strip() for t in result.stdout.split('\n') if t.strip()]

def get_data(table):
    cmd = ["psql", "-X", "-t", "-c", f"SELECT json_agg(t) FROM (SELECT * FROM \"{table}\") t;"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if not result.stdout.strip() or result.stdout.strip() == "":
        return None
    try:
        return json.loads(result.stdout.strip())
    except:
        return None

def format_val(val):
    if val is None:
        return "NULL"
    if isinstance(val, str):
        return "'" + val.replace("'", "''") + "'"
    if isinstance(val, (dict, list)):
        return "'" + json.dumps(val).replace("'", "''") + "'"
    return str(val)

def generate():
    tables = get_tables()
    with open("data_dump.sql", "w") as f:
        f.write("-- Edugen Data Dump\n")
        f.write("SET session_replication_role = 'replica';\n\n")
        for table in tables:
            data = get_data(table)
            if not data:
                continue
            f.write(f"-- Data for {table}\n")
            columns = ", ".join([f'"{c}"' for c in data[0].keys()])
            for row in data:
                values = ", ".join([format_val(v) for v in row.values()])
                f.write(f"INSERT INTO \"{table}\" ({columns}) VALUES ({values}) ON CONFLICT DO NOTHING;\n")
            f.write("\n")
        f.write("SET session_replication_role = 'origin';\n")

if __name__ == "__main__":
    generate()
