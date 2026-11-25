ifeq ($(CXX),g++)
    EXTRA_FLAGS = --no-gnu-unique
else
    EXTRA_FLAGS =
endif

CXXFLAGS ?= -O2
CXXFLAGS += -shared -fPIC -std=c++2b

all:
	$(CXX) $(CXXFLAGS) $(LDFLAGS) $(EXTRA_FLAGS) main.cpp AnchorDeco.cpp AnchorPassElement.cpp -o flurry-anchor.so `pkg-config --cflags --libs pixman-1 libdrm hyprland pangocairo libinput libudev wayland-server xkbcommon`

test:
	$(CXX) -std=c++2b -O1 -Wall -Wextra tests/protocol_test.cpp -o /tmp/flurry-anchor-protocol-test && /tmp/flurry-anchor-protocol-test

clean:
	rm -f ./flurry-anchor.so
