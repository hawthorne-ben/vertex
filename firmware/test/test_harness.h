/*
 * Minimal test harness — no dependencies beyond the C++ standard library.
 *
 * Register a test with TEST(name) { ... } and run them all from main() via
 * runAllTests(). Assertions record a failure and return from the test body;
 * they do not abort the process, so one broken area does not hide the rest.
 *
 * EXPECT_* variants record a failure and continue, for cases where several
 * independent facts are worth reporting from a single test.
 */

#ifndef TEST_HARNESS_H
#define TEST_HARNESS_H

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace vtxtest {

struct TestCase {
  const char* name;
  void (*fn)();
};

inline std::vector<TestCase>& registry() {
  static std::vector<TestCase> tests;
  return tests;
}

// Failures for the test currently running.
inline std::vector<std::string>& currentFailures() {
  static std::vector<std::string> failures;
  return failures;
}

// Tests that document a known defect. Registered separately so a red result
// reads as "the bug is still there", not as a broken suite.
inline std::vector<std::string>& knownDefects() {
  static std::vector<std::string> defects;
  return defects;
}

struct Registrar {
  Registrar(const char* name, void (*fn)()) { registry().push_back({name, fn}); }
};

inline void recordFailure(const char* file, int line, const std::string& msg) {
  char buf[1024];
  snprintf(buf, sizeof(buf), "    %s:%d: %s", file, line, msg.c_str());
  currentFailures().push_back(buf);
}

inline std::string hexDump(const unsigned char* p, int n) {
  std::string s;
  char b[8];
  for (int i = 0; i < n; i++) {
    snprintf(b, sizeof(b), "%02X ", p[i]);
    s += b;
  }
  return s;
}

inline int runAllTests(const char* suiteName) {
  int passed = 0;
  std::vector<std::string> failedNames;

  printf("\n=== %s ===\n\n", suiteName);

  for (const TestCase& t : registry()) {
    currentFailures().clear();
    t.fn();
    if (currentFailures().empty()) {
      printf("  \033[32mPASS\033[0m  %s\n", t.name);
      passed++;
    } else {
      printf("  \033[31mFAIL\033[0m  %s\n", t.name);
      for (const std::string& f : currentFailures()) {
        printf("\033[31m%s\033[0m\n", f.c_str());
      }
      failedNames.push_back(t.name);
    }
  }

  int total = (int)registry().size();
  printf("\n  %d/%d passed\n", passed, total);

  if (!knownDefects().empty()) {
    printf("\n  Known defects asserted by this suite:\n");
    for (const std::string& d : knownDefects()) {
      printf("    - %s\n", d.c_str());
    }
  }

  if (!failedNames.empty()) {
    printf("\n\033[31m  FAILED:\033[0m\n");
    for (const std::string& n : failedNames) printf("    %s\n", n.c_str());
    printf("\n");
    return 1;
  }
  printf("\n");
  return 0;
}

}  // namespace vtxtest

#define TEST(name)                                                    \
  static void name();                                                 \
  static vtxtest::Registrar name##_registrar(#name, name);            \
  static void name()

// Note a test that pins a known-defective behavior, so the summary lists it.
#define NOTE_KNOWN_DEFECT(desc) \
  vtxtest::knownDefects().push_back(desc)

#define FAIL_MSG(...)                                        \
  do {                                                       \
    char _m[512];                                            \
    snprintf(_m, sizeof(_m), __VA_ARGS__);                   \
    vtxtest::recordFailure(__FILE__, __LINE__, _m);          \
  } while (0)

#define EXPECT_TRUE(cond)                                    \
  do {                                                       \
    if (!(cond)) FAIL_MSG("expected true: %s", #cond);       \
  } while (0)

#define ASSERT_TRUE(cond)                                    \
  do {                                                       \
    if (!(cond)) { FAIL_MSG("expected true: %s", #cond); return; } \
  } while (0)

#define EXPECT_EQ_INT(actual, expected)                                     \
  do {                                                                      \
    long long _a = (long long)(actual), _e = (long long)(expected);         \
    if (_a != _e)                                                           \
      FAIL_MSG("%s: expected %lld, got %lld", #actual, _e, _a);             \
  } while (0)

#define ASSERT_EQ_INT(actual, expected)                                     \
  do {                                                                      \
    long long _a = (long long)(actual), _e = (long long)(expected);         \
    if (_a != _e) {                                                         \
      FAIL_MSG("%s: expected %lld, got %lld", #actual, _e, _a); return; }   \
  } while (0)

#define EXPECT_EQ_STR(actual, expected)                                     \
  do {                                                                      \
    if (strcmp((actual), (expected)) != 0)                                  \
      FAIL_MSG("%s: expected \"%s\", got \"%s\"", #actual, (expected), (actual)); \
  } while (0)

#define EXPECT_NEAR(actual, expected, tol)                                  \
  do {                                                                      \
    double _a = (double)(actual), _e = (double)(expected);                  \
    if (std::fabs(_a - _e) > (tol))                                         \
      FAIL_MSG("%s: expected %.9g +/- %g, got %.9g (delta %.3g)",           \
               #actual, _e, (double)(tol), _a, _a - _e);                    \
  } while (0)

// Compare a byte range against expected bytes, reporting a hex diff.
#define EXPECT_BYTES_EQ(actual, expected, n)                                \
  do {                                                                      \
    const unsigned char* _a = (const unsigned char*)(actual);               \
    const unsigned char* _e = (const unsigned char*)(expected);             \
    if (memcmp(_a, _e, (n)) != 0)                                           \
      FAIL_MSG("bytes differ over %d:\n      expected: %s\n      actual:   %s", \
               (int)(n), vtxtest::hexDump(_e, (n)).c_str(),                 \
               vtxtest::hexDump(_a, (n)).c_str());                          \
  } while (0)

#endif // TEST_HARNESS_H
