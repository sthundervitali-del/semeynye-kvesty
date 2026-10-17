# Собирает apps-script/Code.gs из core.js + server.gs + deploy.gs
import pathlib
r = pathlib.Path(__file__).parent
hdr = ('/* Файл собран автоматически: core.js + server.gs + deploy.gs. Вставьте его целиком в Code.gs. */\n'
       '/** Нажмите «Выполнить», чтобы опубликовать свежую версию приложения с GitHub. */\n'
       'function publishApp() { checkMail(); deploy(); }\n\n')
parts = [(r/'public/core.js').read_text(), (r/'apps-script/server.gs').read_text(), (r/'apps-script/deploy.gs').read_text()]
(r/'apps-script/Code.gs').write_text(hdr + '\n'.join(p.rstrip('\n') + '\n' for p in parts))
