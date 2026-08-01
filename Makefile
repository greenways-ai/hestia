HESTIA := scripts/hestia

.PHONY: help doctor up down status client-env backup restore

help:
	@echo 'make doctor                         Check local prerequisites'
	@echo 'make up                             Start Hestia'
	@echo 'make down                           Stop Hestia without deleting data'
	@echo 'make status                         Print public local endpoints'
	@echo 'make client-env                     Print browser-safe connection values'
	@echo 'make backup                         Back up Auth and ledger data'
	@echo 'make restore DIR=... CONFIRM=restore Restore a backup'

doctor:
	@$(HESTIA) doctor

up:
	@$(HESTIA) up

down:
	@$(HESTIA) down

status:
	@$(HESTIA) status

client-env:
	@$(HESTIA) client-env

backup:
	@$(HESTIA) backup

restore:
	@test -n "$(DIR)" || { echo "Usage: make restore DIR=path/to/backup CONFIRM=restore" >&2; exit 1; }
	@test "$(CONFIRM)" = "restore" || { echo "Restore replaces local state; rerun with CONFIRM=restore" >&2; exit 1; }
	@$(HESTIA) restore "$(DIR)" --confirm
