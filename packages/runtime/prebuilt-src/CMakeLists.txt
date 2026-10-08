# The prebuilt runtime's core (see packages/compiler/src/prebuilt-runtime.ts):
# the runtime's sources that depend on neither JSI nor React Native, as one
# static library, built by scripts/prebuilt-runtime.ts for each target with
# the flags the podspec and android/CMakeLists.txt build the runtime with.
#
#   cmake -S packages/runtime/prebuilt-src -B <build> -DLUCENT_CPP=<runtime>/cpp \
#     -DLUCENT_CORE_SOURCES=<file listing them> [the target's toolchain]
cmake_minimum_required(VERSION 3.13)
project(lucentcore C CXX)

file(STRINGS ${LUCENT_CORE_SOURCES} LUCENT_CORE)
set(sources)
foreach(f ${LUCENT_CORE})
  list(APPEND sources ${LUCENT_CPP}/${f})
endforeach()

add_library(lucentcore STATIC ${sources})
target_include_directories(lucentcore PRIVATE ${LUCENT_CPP})
set_target_properties(lucentcore PROPERTIES POSITION_INDEPENDENT_CODE ON C_STANDARD 11)
separate_arguments(cxx_flags UNIX_COMMAND "${LUCENT_CXX_FLAGS}")
separate_arguments(c_flags UNIX_COMMAND "${LUCENT_C_FLAGS}")
target_compile_options(lucentcore PRIVATE
  $<$<COMPILE_LANGUAGE:CXX>:${cxx_flags}>
  $<$<COMPILE_LANGUAGE:C>:${c_flags}>
)
