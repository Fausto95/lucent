#include "entropy.h"

#include <cerrno>
#include <cstdio>

#if defined(__APPLE__)
#include <stdlib.h>
#else
#include <fcntl.h>
#include <sys/syscall.h>
#include <unistd.h>
#endif

namespace lucent {

void secureRandom(uint8_t* bytes, size_t n) {
#if defined(__APPLE__)
  arc4random_buf(bytes, n);
#else
  size_t done = 0;
#if defined(SYS_getrandom)
  // The system call, not getrandom(3), which Android's libc has from API 28 only.
  while (done < n) {
    const long r = syscall(SYS_getrandom, bytes + done, n - done, 0);
    if (r > 0) {
      done += static_cast<size_t>(r);
    } else if (r < 0 && errno != EINTR) {
      break;
    }
  }
#endif
  if (done < n) {
    const int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
    while (fd >= 0 && done < n) {
      const ssize_t r = read(fd, bytes + done, n - done);
      if (r > 0) {
        done += static_cast<size_t>(r);
      } else if (r == 0 || errno != EINTR) {
        break;
      }
    }
    if (fd >= 0) close(fd);
  }
  if (done < n) throwError(String::fromLatin1("Error"), String::fromLatin1("The platform's secure random generator failed"));
#endif
}

void randomQuotaExceeded() {
  throwError(String::fromLatin1("QuotaExceededError"), String::fromLatin1("The requested length exceeds 65,536 bytes"));
}

String randomUUID() {
  uint8_t b[16];
  secureRandom(b, sizeof b);
  b[6] = static_cast<uint8_t>((b[6] & 0x0F) | 0x40);
  b[8] = static_cast<uint8_t>((b[8] & 0x3F) | 0x80);
  static constexpr char kHex[] = "0123456789abcdef";
  char out[36];
  size_t at = 0;
  for (size_t i = 0; i < 16; i++) {
    if (i == 4 || i == 6 || i == 8 || i == 10) out[at++] = '-';
    out[at++] = kHex[b[i] >> 4];
    out[at++] = kHex[b[i] & 0x0F];
  }
  return String::fromLatin1(std::string_view(out, sizeof out));
}

}  // namespace lucent
