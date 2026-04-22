PORT ?= 8765

dev:
	@PORT=$(PORT) docker compose up web

serve:
	@echo ""
	@echo "  ⌂  Hey Casa — http://localhost:$(PORT)"
	@echo ""
	@PORT=$(PORT) docker compose up web

dev-down:
	@PORT=$(PORT) docker compose stop web
	@PORT=$(PORT) docker compose rm -f web

broker:
	@docker compose up broker

broker-down:
	@docker compose stop broker
	@docker compose rm -f broker

broker-logs:
	@docker compose logs -f broker

push:
	@git add .
	@git commit -m "update" || true
	@git push
