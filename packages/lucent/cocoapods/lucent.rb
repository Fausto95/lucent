# Lucent's CocoaPods hook. The Expo config plugin calls it from the
# Podfile's post_install, after requiring this file:
#
#   require File.join(File.dirname(`node --print "require.resolve('@lucent-lang/lucent/package.json')"`), "cocoapods/lucent")
#
#   post_install do |installer|
#     lucent_post_install(installer)
#     ...
#
# Once pod install has installed the pods, it runs lucent build, which binds
# what the Lucent packages' pods define (expo prebuild leaves them unbound
# until they are installed), and lists the sources that build added in the
# LucentNative target, as the next pod install would: the app builds with
# no second pod install.

require "pathname"

def lucent_post_install(installer)
  pod_target = installer.pod_targets.find { |t| t.pod_name == "LucentNative" }
  return if pod_target.nil?

  native = pod_target.file_accessors.first.root.to_s
  podspec = File.join(native, "LucentNative.podspec")
  project = File.read(podspec)[/^lucent_project = "(.*)"$/, 1]
  return if project.nil?

  root = File.expand_path(project, native)
  node = ENV["NODE_BINARY"].to_s.empty? ? "node" : ENV["NODE_BINARY"]
  cli = File.expand_path("../bin/lucent.cjs", __dir__)
  env = { "LUCENT_POD_INSTALL" => "1", "LUCENT_NO_GRADLE" => "1" }

  Pod::UI.section("Building Lucent's modules with the installed pods") do
    unless system(env, node, cli, "build", chdir: root)
      Pod::UI.warn("lucent build failed: the app's iOS build shows why, and runs it again")
      return
    end
  end

  # The podspec as this build wrote it (evaluating it records what pod install saw).
  spec = Pod::Specification.from_file(podspec)
  before = pod_target.file_accessors.first.spec_consumer.frameworks
  lucent_sync_sources(installer, pod_target, spec, native)
  lucent_link_frameworks(installer, pod_target, spec.consumer(:ios).frameworks - before)
end

# The Apple frameworks this build's podspec added since CocoaPods read it,
# linked as CocoaPods links a pod's: in the app's Pods xcconfigs, and in
# LucentNative's own when it is a dynamic framework.
def lucent_link_frameworks(installer, pod_target, added)
  return if added.empty?

  flags = added.map { |f| %(-framework "#{f}") }.join(" ")
  apps = installer.aggregate_targets.select { |t| t.pod_targets.include?(pod_target) }
  configurations = apps.flat_map { |t| t.user_build_configurations.keys }.uniq
  files = apps.flat_map { |t| configurations.map { |c| t.xcconfig_path(c) } }
  files += configurations.map { |c| pod_target.xcconfig_path(c) } if pod_target.build_as_dynamic?

  files.uniq.select { |f| File.exist?(f) }.each do |f|
    text = File.read(f)
    text = if text =~ /^OTHER_LDFLAGS = /
      text.sub(/^(OTHER_LDFLAGS = .*)$/) { "#{$1} #{flags}" }
    else
      "#{text.chomp}\nOTHER_LDFLAGS = $(inherited) #{flags}\n"
    end
    File.write(f, text)
  end
end

# LucentNative's target with the sources `spec` lists now: the ones a build
# added since CocoaPods listed them, and Swift's version when Swift came.
def lucent_sync_sources(installer, pod_target, spec, native)
  projects = [installer.pods_project]
  projects += installer.pod_target_subprojects if installer.respond_to?(:pod_target_subprojects)
  target = projects.compact.flat_map(&:targets).find { |t| t.name == pod_target.label }
  return if target.nil?

  consumer = spec.consumer(:ios)
  accessor = Pod::Sandbox::FileAccessor.new(Pod::Sandbox::PathList.new(Pathname.new(native)), consumer)
  wanted = accessor.source_files - accessor.headers
  phase = target.source_build_phase
  # Compared through links (/var is /private/var on macOS), as each names a file once.
  real = ->(f) { File.exist?(f.to_s) ? File.realpath(f.to_s) : f.to_s }
  listed = phase.files.map { |f| f.file_ref && real.call(f.file_ref.real_path) }.compact
  group = target.project.main_group.find_subpath(File.join("Development Pods", "LucentNative"), false) ||
          target.project.main_group

  added = wanted.reject { |f| listed.include?(real.call(f)) }
  added.each { |f| phase.add_file_reference(group.new_reference(f.to_s), true) }

  gone = phase.files.select { |f| f.file_ref && !File.exist?(f.file_ref.real_path.to_s) }
  gone.each do |f|
    ref = f.file_ref
    phase.remove_build_file(f)
    ref.remove_from_project
  end

  if wanted.any? { |f| f.extname == ".swift" } && consumer.spec.swift_version
    target.build_configurations.each do |c|
      c.build_settings["SWIFT_VERSION"] ||= consumer.spec.swift_version.to_s
    end
  end

  return if added.empty? && gone.empty?

  Pod::UI.message("LucentNative: #{added.size} source(s) added, #{gone.size} removed since CocoaPods listed them")
end
