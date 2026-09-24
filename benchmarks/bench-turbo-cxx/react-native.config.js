// A pure C++ TurboModule: Android compiles cpp/ into the app's appmodules
// library; iOS registers it from ios/ when the binary loads.
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: "android",
        // Autolinking registers C++ modules only for named libraries. Not
        // "benchturbocxx": <benchturbocxx.h> would find cpp/BenchTurboCxx.h on
        // case-insensitive file systems.
        libraryName: "benchturbocxxnative",
        cxxModuleCMakeListsModuleName: "benchturbocxx",
        cxxModuleCMakeListsPath: "CMakeLists.txt",
        cxxModuleHeaderName: "BenchTurboCxx",
      },
      ios: {},
    },
  },
};
