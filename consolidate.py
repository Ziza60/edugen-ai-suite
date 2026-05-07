import os
import re

migrations_dir = 'supabase/migrations'
files = sorted([f for f in os.listdir(migrations_dir) if f.endswith('.sql')])

all_sql = []
for f in files:
    with open(os.path.join(migrations_dir, f), 'r') as file:
        all_sql.append(f"-- Migration: {f}\n" + file.read() + "\n")

full_sql = "\n".join(all_sql)

# Ensure essential structural elements are at the top (order matters in SQL)
# This is a bit simplified, but psql handles multiple files well if concatenated in order
with open('edugen_final_schema.sql', 'w') as f:
    f.write(full_sql)

