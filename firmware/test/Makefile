# Host-compiled tests for firmware/imu_manager_v2 pure logic.
#
#   make test        build and run the unit suite
#   make crosscheck  additionally decode firmware-encoded bytes with the
#                    Python parser in packages/vtx-parser (needs python3)
#   make all         both
#   make clean
#
# No Arduino IDE, no ESP32 toolchain, no third-party test framework.

CXX      ?= c++
CXXFLAGS ?= -std=c++17 -O1 -g -Wall -Wextra -Wno-unused-parameter
BUILD    := build

# Some macOS Command Line Tools installs leave usr/include/c++/v1 present but
# unusable, so <cstdint> and friends are not found even though the SDK ships
# them. Detect that and point the compiler at the SDK's copy. A healthy
# toolchain (and any Linux host) takes the first branch and adds no flags.
STDLIB_PROBE := $(shell printf '\#include <cstdint>\nint main(){return 0;}\n' > /tmp/.vtx_probe.cpp 2>/dev/null && $(CXX) -std=c++17 -fsyntax-only /tmp/.vtx_probe.cpp 2>/dev/null && echo ok)
ifneq ($(STDLIB_PROBE),ok)
  SDK_CXX_INC := $(shell xcrun --show-sdk-path 2>/dev/null)/usr/include/c++/v1
  CXXFLAGS += $(if $(wildcard $(SDK_CXX_INC)),-cxx-isystem $(SDK_CXX_INC),)
endif

UNIT_BIN := $(BUILD)/test_vtx_format
UNIT_SRC := test_vtx_format.cpp
GEN_BIN  := $(BUILD)/gen_vtx_fixture
GEN_SRC  := gen_vtx_fixture.cpp

DEPS := test_harness.h ../imu_manager_v2/vtx_format.h ../imu_manager_v2/config.h

.PHONY: all test crosscheck clean

test: $(UNIT_BIN)
	@./$(UNIT_BIN)

# Encode a .vtx file with the firmware's own code, then decode it with the
# packages/vtx-parser Python implementation and diff the round trip.
crosscheck: $(GEN_BIN)
	@python3 crosscheck.py ./$(GEN_BIN)

all: test crosscheck

$(UNIT_BIN): $(UNIT_SRC) $(DEPS) | $(BUILD)
	@$(CXX) $(CXXFLAGS) -o $@ $(UNIT_SRC)

$(GEN_BIN): $(GEN_SRC) $(DEPS) | $(BUILD)
	@$(CXX) $(CXXFLAGS) -o $@ $(GEN_SRC)

$(BUILD):
	@mkdir -p $(BUILD)

clean:
	@rm -rf $(BUILD)
