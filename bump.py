"""Новая версия приложения: python3 bump.py 2.11.1
Обновляет номер версии и дату выпуска (по Минску) в app.js и index.html."""
import re, sys, datetime, pathlib
v = sys.argv[1]
d = (datetime.datetime.utcnow() + datetime.timedelta(hours=3)).strftime("%d.%m.%Y")
r = pathlib.Path(__file__).parent / "public"
app = (r / "app.js").read_text()
app, n = re.subn(r'const APP_VERSION = "[^"]+", APP_DATE = "[^"]+";', f'const APP_VERSION = "{v}", APP_DATE = "{d}";', app)
assert n == 1, "APP_VERSION не найден"
(r / "app.js").write_text(app)
html = (r / "index.html").read_text()
html, n = re.subn(r'<meta name="app-version" content="[^"]+">', f'<meta name="app-version" content="{v}">', html)
assert n == 1, "app-version не найден"
(r / "index.html").write_text(html)
print(v, d)
