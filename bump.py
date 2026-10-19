# Новая версия приложения: python3 bump.py 2.11.1 — обновляет номер, дату (по Минску) и метку в index.html.
import re, sys, datetime, pathlib
v = sys.argv[1]
d = (datetime.datetime.utcnow() + datetime.timedelta(hours=3)).strftime("%d.%m.%Y")
r = pathlib.Path(__file__).parent / "public"
a = (r / "app.js").read_text()
a = re.sub(r'const APP_VERSION = "[^"]+", APP_DATE = "[^"]+";', f'const APP_VERSION = "{v}", APP_DATE = "{d}";', a)
(r / "app.js").write_text(a)
h = (r / "index.html").read_text()
h = re.sub(r'name="app-version" content="[^"]+"', f'name="app-version" content="{v}"', h)
(r / "index.html").write_text(h)
print(v, d)
