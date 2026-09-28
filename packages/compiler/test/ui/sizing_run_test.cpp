// The fixture's Caption laid out by React Native's renderer (its Yoga
// integration, as the prebuilt framework has it), with no size of its own:
// what its shadow node sizes it at before and after its host's
// measurements reach the state, and the constraints it asks the host to
// measure under (at most the root's height: Yoga bounds the column by it). Prints one line per step; sizing-run.test.ts checks them.
#include <views/LucentCaption_90d454e99718.h>

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/element/ComponentBuilder.h>
#include <react/renderer/element/Element.h>
#include <react/utils/ContextContainer.h>

#include <cmath>
#include <cstdio>
#include <memory>
#include <string>

namespace caption = lucent::views::LucentCaption_90d454e99718;
namespace react = facebook::react;
namespace sizing = lucent::sizing;

namespace {

react::ComponentBuilder builder() {
  react::ComponentDescriptorProviderRegistry providers;
  auto registry = providers.createComponentDescriptorRegistry(
      react::ComponentDescriptorParameters{.eventDispatcher = {}, .contextContainer = nullptr, .flavor = nullptr});

  providers.add(react::concreteComponentDescriptorProvider<react::RootComponentDescriptor>());
  providers.add(react::concreteComponentDescriptorProvider<react::ViewComponentDescriptor>());
  providers.add(react::concreteComponentDescriptorProvider<caption::ComponentDescriptor>());

  return react::ComponentBuilder{registry};
}

std::string number(float value) {
  if (std::isinf(value)) return "inf";

  char out[32];
  std::snprintf(out, sizeof out, "%g", value);

  return out;
}

/// `WxH`, then the font scale unless 1 (`x1.5`) and `rtl` for a right-to-left layout.
std::string constraints(const std::optional<sizing::Constraints>& c) {
  if (!c) return "none";

  auto out = number(c->maxWidth) + "x" + number(c->maxHeight);

  if (c->fontScale != 1) out += " x" + number(c->fontScale);

  if (c->direction == sizing::Direction::RightToLeft) out += " rtl";

  return out;
}

/** The Caption node of `root` (root > view > caption). */
const caption::ShadowNode& captionOf(const react::ShadowNode& root) {
  return static_cast<const caption::ShadowNode&>(*root.getChildren().at(0)->getChildren().at(0));
}

/** One step: the Caption's frame and the constraints its state asks for. */
void print(const char* step, const react::ShadowNode& root) {
  const auto& node = captionOf(root);
  auto frame = node.getLayoutMetrics().frame.size;

  std::printf(
      "%s: %sx%s asks %s\n",
      step,
      number(frame.width).c_str(),
      number(frame.height).c_str(),
      constraints(node.getStateData().requested).c_str());
}

/** `root` laid out again after `transform` replaced the Caption's node. */
std::shared_ptr<react::RootShadowNode> relayout(
    const react::RootShadowNode& root,
    const react::ShadowNodeFamily& family,
    const std::function<std::shared_ptr<react::ShadowNode>(const react::ShadowNode&)>& transform) {
  auto next = std::static_pointer_cast<react::RootShadowNode>(root.cloneTree(family, transform));

  next->layoutIfNeeded();

  return next;
}

/** The host's result reaching the state, as a state update commits it (when judge accepts it). */
std::shared_ptr<react::RootShadowNode> measured(std::shared_ptr<react::RootShadowNode> root, sizing::Measurement result) {
  const auto& node = captionOf(*root);
  auto verdict = sizing::judge(node.getStateData(), result, 2);

  std::printf("result %s: %s\n", constraints(result.constraints).c_str(), sizing::verdictName(verdict));

  if (verdict != sizing::Verdict::Accepted) return root;

  auto data = node.getStateData();
  data.measured = result;

  auto state = std::make_shared<const caption::ShadowNode::ConcreteState>(
      std::make_shared<const caption::ShadowNode::ConcreteStateData>(std::move(data)), *node.getState());

  return relayout(*root, node.getFamily(), [&](const react::ShadowNode& old) {
    return old.clone({.props = nullptr, .children = nullptr, .state = state});
  });
}

/// A result reaching a state whose family `root` no longer has (the view was removed, its host recycled).
void pending(const react::RootShadowNode& root, const react::ShadowNodeFamily& family, sizing::Measurement result) {
  auto judged = false;
  auto next = root.cloneTree(family, [&](const react::ShadowNode& old) {
    judged = true;
    return old.clone({});
  });

  std::printf(
      "result %s after removal: %s\n", constraints(result.constraints).c_str(), next || judged ? "applied" : "dropped");
}

/// `root` with the surface's constraints and context changed (a shorter window, a font scale, a direction).
std::shared_ptr<react::RootShadowNode> resurface(
    const react::RootShadowNode& root, float height, float fontScale, react::LayoutDirection direction) {
  static const react::ContextContainer container;
  react::PropsParserContext parser{-1, container};
  react::LayoutContext context;

  context.pointScaleFactor = 2;
  context.fontSizeMultiplier = fontScale;

  auto next = root.clone(
      parser,
      react::LayoutConstraints{.minimumSize = {0, 0}, .maximumSize = {300, height}, .layoutDirection = direction},
      context);

  next->layoutIfNeeded();

  return next;
}

std::shared_ptr<react::ViewProps> viewWidth(float width) {
  auto props = std::make_shared<react::ViewProps>();

  props->yogaStyle.setDimension(facebook::yoga::Dimension::Width, facebook::yoga::StyleSizeLength::points(width));

  return props;
}

}  // namespace

int main() {
  std::shared_ptr<react::RootShadowNode> root;

  auto element =
      react::Element<react::RootShadowNode>()
          .reference(root)
          .tag(1)
          .props([] {
            auto props = std::make_shared<react::RootProps>();

            props->layoutConstraints = react::LayoutConstraints{.minimumSize = {0, 0}, .maximumSize = {300, 500}};
            props->layoutContext.pointScaleFactor = 2;
            props->yogaStyle.setDimension(facebook::yoga::Dimension::Width, facebook::yoga::StyleSizeLength::points(300));
            props->yogaStyle.setDimension(facebook::yoga::Dimension::Height, facebook::yoga::StyleSizeLength::points(500));

            return props;
          })
          .children({
              react::Element<react::ViewShadowNode>().tag(2).props([] { return viewWidth(200); }).children({
                  react::Element<caption::ShadowNode>().tag(3),
              }),
          });

  // Kept: the families' descriptors live in its registry.
  auto components = builder();

  components.build(element);
  root->layoutIfNeeded();
  print("first layout", *root);

  root = measured(root, {1, {200, 500}, {180, 42}});
  print("measured", *root);

  // The container narrows: laid out at the last size until the host measures again.
  const auto& view = *root->getChildren().at(0);

  root = relayout(*root, view.getFamily(), [](const react::ShadowNode& old) {
    return old.clone({.props = viewWidth(100), .children = nullptr, .state = nullptr});
  });
  print("narrowed", *root);

  root = measured(root, {1, {200, 500}, {180, 42}});
  root = measured(root, {2, {100, 500}, {100, 84.5f}});
  print("measured again", *root);

  root = measured(root, {1, {100, 500}, {100, 42}});
  root = measured(root, {2, {100, 500}, {100, 84.4f}});
  print("settled", *root);

  // A stricter height bound the measurement fits: nothing to measure again.
  root = resurface(*root, 400, 1, react::LayoutDirection::LeftToRight);
  print("shortened", *root);

  // Text sizes with the font scale: the node's next layout asks for a
  // measurement under it. (This renderer lays a node out again for a new
  // font scale only when something else changes it: here its width.)
  root = resurface(*root, 380, 1.5f, react::LayoutDirection::LeftToRight);
  root = relayout(*root, root->getChildren().at(0)->getFamily(), [](const react::ShadowNode& old) {
    return old.clone({.props = viewWidth(120), .children = nullptr, .state = nullptr});
  });
  print("font scale 1.5, wider", *root);
  root = measured(root, {2, {120, 380}, {120, 84.5f}});
  root = measured(root, {3, {120, 380, 1.5f}, {120, 105.5f}});
  print("measured at 1.5", *root);

  root = resurface(*root, 380, 1.5f, react::LayoutDirection::RightToLeft);
  print("right to left", *root);
  root = measured(root, {3, {120, 380, 1.5f, sizing::Direction::RightToLeft}, {120, 105.5f}});
  print("measured right to left", *root);

  // Removed while the host measures: its result finds no node to update.
  auto caption = captionOf(*root).getFamilyShared();

  root = relayout(*root, root->getChildren().at(0)->getFamily(), [](const react::ShadowNode& old) {
    return old.clone({.props = nullptr, .children = react::ShadowNode::emptySharedShadowNodeSharedList(), .state = nullptr});
  });
  pending(*root, *caption, {4, {120, 380, 1.5f, sizing::Direction::RightToLeft}, {120, 200}});

  return 0;
}
