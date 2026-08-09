HESTIA := scripts/hestia

.PHONY: help doctor up bootstrap-agent down status client-env backup restore boundary-check controller-check controller-test

help:
	@echo 'make doctor                         Check local prerequisites'
	@echo 'make up                             Start Hestia'
	@echo 'make bootstrap-agent                Register the local environment key and pinned policies'
	@echo 'make down                           Stop Hestia without deleting data'
	@echo 'make status                         Print public local endpoints'
	@echo 'make client-env                     Print browser-safe connection values'
	@echo 'make backup                         Back up Auth, ledger data, and the environment signer'
	@echo 'make restore DIR=... CONFIRM=restore Restore a backup'
	@echo 'make boundary-check                  Enforce the Hestia/Ignatius boundary'
	@echo 'make controller-check               Check the portable Hestia controller'
	@echo 'make controller-test                Test the portable Hestia controller'

doctor:
	@$(HESTIA) doctor

up:
	@$(HESTIA) up

bootstrap-agent:
	@$(HESTIA) bootstrap-agent

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

boundary-check:
	bash scripts/check-architecture-boundaries

controller-check:
	hara --project hal check

controller-test:
	hara --project hal test
