CC = gcc
CFLAGS = -O2 -Wall -Wextra -pthread -Iinclude
LDFLAGS = -ldl

all: softplc

softplc: src/main.c src/db_registry.c src/logic_loader.c
	$(CC) $(CFLAGS) $^ -o $@ $(LDFLAGS)

clean:
	rm -f softplc
