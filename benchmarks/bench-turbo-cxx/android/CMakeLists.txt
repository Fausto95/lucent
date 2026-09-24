# Built into the app's `appmodules` library through React Native's C++
# module autolinking (see react-native.config.js).
cmake_minimum_required(VERSION 3.13)

add_library(benchturbocxx INTERFACE)
target_include_directories(benchturbocxx INTERFACE ${CMAKE_CURRENT_LIST_DIR}/../cpp)
target_link_libraries(benchturbocxx INTERFACE jsi reactnative)
