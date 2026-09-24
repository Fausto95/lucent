// A pure C++ TurboModule: Android compiles cpp/ into the app's appmodules
// library; iOS registers it from ios/ when the binary loads.
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: "android",
        cxxModuleCMakeListsModuleName: "benchturbocxx",
        cxxModuleCMakeListsPath: "CMakeLists.txt",
        cxxModuleHeaderName: "BenchTurboCxx",
      },
      ios: {},
    },
  },
};
