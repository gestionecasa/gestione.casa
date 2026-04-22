PORT ?= 8765

dev:
	@python3 contrib/dev-server.py $(PORT)

serve:
	@echo ""
	@echo "  ⌂  Hey Casa — http://localhost:$(PORT)"
	@echo ""
	@python3 -m http.server $(PORT) --bind 127.0.0.1

push:
	@git add .
	@git commit -m "update" || true
	@git push
