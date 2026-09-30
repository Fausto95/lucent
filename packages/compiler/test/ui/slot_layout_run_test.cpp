// The fixture's Card, which takes React children, laid out by React
// Native's renderer (its Yoga integration, as the prebuilt framework has
// it) before and after its host reports where its slot is: in the content
// box until the first report, then in the slot's rectangle. The host's own
// content box never moves with the slot. Prints one line per step;
// slot-layout-run.test.ts checks them.
#include <views/CARD.h>

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/element/ComponentBuilder.h>
#include <react/renderer/element/Element.h>

#include <cstdio>
#include <functional>
#include <memory>
#include <string>

namespace card = lucent::views::CARD;
namespace react = facebook::react;
namespace slots = lucent::slots;
namespace yoga = facebook::yoga;

namespace {

react::ComponentBuilder builder() {
  react::ComponentDescriptorProviderRegistry providers;
  auto registry = providers.createComponentDescriptorRegistry(
      react::ComponentDescriptorParameters{.eventDispatcher = {}, .contextContainer = nullptr, .flavor = nullptr});

  providers.add(react::concreteComponentDescriptorProvider<react::RootComponentDescriptor>());
  providers.add(react::concreteComponentDescriptorProvider<react::ViewComponentDescriptor>());
  providers.add(react::concreteComponentDescriptorProvider<card::ComponentDescriptor>());

  return react::ComponentBuilder{registry};
}

const react::LayoutableShadowNode& layoutable(const react::ShadowNode& node) {
  return static_cast<const react::LayoutableShadowNode&>(node);
}

std::string frame(const react::ShadowNode& node) {
  auto f = layoutable(node).getLayoutMetrics().frame;
  char out[64];

  std::snprintf(out, sizeof out, "%g,%g %gx%g", f.origin.x, f.origin.y, f.size.width, f.size.height);

  return out;
}

/** The content box the host lays the setup's view out in: its insets from the frame, and its border. */
std::string box(const react::ShadowNode& node) {
  auto m = layoutable(node).getLayoutMetrics();
  char out[96];

  std::snprintf(
      out,
      sizeof out,
      "content %g,%g,%g,%g border %g",
      m.contentInsets.left,
      m.contentInsets.top,
      m.contentInsets.right,
      m.contentInsets.bottom,
      m.borderWidth.left);

  return out;
}

/** A card of `root` (root > cards). */
const react::ShadowNode& cardOf(const react::ShadowNode& root, size_t index) { return *root.getChildren().at(index); }

std::shared_ptr<react::RootShadowNode> relayout(
    const react::RootShadowNode& root,
    const react::ShadowNodeFamily& family,
    const std::function<std::shared_ptr<react::ShadowNode>(const react::ShadowNode&)>& transform) {
  auto next = std::static_pointer_cast<react::RootShadowNode>(root.cloneTree(family, transform));

  next->layoutIfNeeded();

  return next;
}

/** The host's report reaching a card's state, as a state update commits it (when judge accepts it). */
std::shared_ptr<react::RootShadowNode> reported(
    std::shared_ptr<react::RootShadowNode> root,
    size_t index,
    slots::Placement report) {
  const auto& node = static_cast<const card::ShadowNode&>(cardOf(*root, index));
  auto verdict = slots::judge(node.getStateData().slot, report, 2);

  std::printf("report %llu: %s\n", static_cast<unsigned long long>(report.revision), slots::verdictName(verdict));

  if (verdict != slots::Verdict::Accepted) return root;

  auto data = node.getStateData();

  data.slot = report;

  auto state = std::make_shared<const card::ShadowNode::ConcreteState>(
      std::make_shared<const card::ShadowNode::ConcreteStateData>(std::move(data)), *node.getState());

  return relayout(*root, node.getFamily(), [&](const react::ShadowNode& old) {
    return old.clone({.props = nullptr, .children = nullptr, .state = state});
  });
}

/** A card's props: 200 wide (and `height` tall, if any), padding 10, border 2. */
std::shared_ptr<card::Props> cardProps(float height, yoga::Direction direction = yoga::Direction::Inherit) {
  auto props = std::make_shared<card::Props>();

  props->yogaStyle.setDimension(yoga::Dimension::Width, yoga::StyleSizeLength::points(200));

  if (height > 0) props->yogaStyle.setDimension(yoga::Dimension::Height, yoga::StyleSizeLength::points(height));

  props->yogaStyle.setPadding(yoga::Edge::All, yoga::StyleLength::points(10));
  props->yogaStyle.setBorder(yoga::Edge::All, yoga::StyleLength::points(2));
  props->yogaStyle.setDirection(direction);

  return props;
}

/** A View filling what its parent lays it out in. */
std::shared_ptr<react::ViewProps> filling() {
  auto props = std::make_shared<react::ViewProps>();

  props->yogaStyle.setFlexGrow(yoga::FloatOptional(1));

  return props;
}

/** A 10x10 View at the top left corner its parent positions it from. */
std::shared_ptr<react::ViewProps> cornered() {
  auto props = std::make_shared<react::ViewProps>();

  props->yogaStyle.setPositionType(yoga::PositionType::Absolute);
  props->yogaStyle.setPosition(yoga::Edge::Top, yoga::StyleLength::points(0));
  props->yogaStyle.setPosition(yoga::Edge::Left, yoga::StyleLength::points(0));
  props->yogaStyle.setDimension(yoga::Dimension::Width, yoga::StyleSizeLength::points(10));
  props->yogaStyle.setDimension(yoga::Dimension::Height, yoga::StyleSizeLength::points(10));

  return props;
}

/** A View of `height`, stretched across its parent. */
std::shared_ptr<react::ViewProps> tall(float height) {
  auto props = std::make_shared<react::ViewProps>();

  props->yogaStyle.setDimension(yoga::Dimension::Height, yoga::StyleSizeLength::points(height));

  return props;
}

/** The fixed card (index 0): its frame, content box, and its filling and cornered children. */
void printFixed(const char* step, const react::ShadowNode& root) {
  const auto& fixed = cardOf(root, 0);

  std::printf(
      "%s: card %s %s, fill %s, corner %s\n",
      step,
      frame(fixed).c_str(),
      box(fixed).c_str(),
      frame(*fixed.getChildren().at(0)).c_str(),
      frame(*fixed.getChildren().at(1)).c_str());
}

/** The card sized by its children (index 1): its frame and its children's. */
void printSized(const char* step, const react::ShadowNode& root) {
  const auto& sized = cardOf(root, 1);

  std::printf(
      "%s: card %s %s, children %s and %s\n",
      step,
      frame(sized).c_str(),
      box(sized).c_str(),
      frame(*sized.getChildren().at(0)).c_str(),
      frame(*sized.getChildren().at(1)).c_str());
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
            props->yogaStyle.setDimension(yoga::Dimension::Width, yoga::StyleSizeLength::points(300));
            props->yogaStyle.setDimension(yoga::Dimension::Height, yoga::StyleSizeLength::points(500));
            props->yogaStyle.setAlignItems(yoga::Align::FlexStart);

            return props;
          })
          .children({
              react::Element<card::ShadowNode>().tag(2).props([] { return cardProps(150); }).children({
                  react::Element<react::ViewShadowNode>().tag(3).props([] { return filling(); }),
                  react::Element<react::ViewShadowNode>().tag(4).props([] { return cornered(); }),
              }),
              react::Element<card::ShadowNode>().tag(5).props([] { return cardProps(0); }).children({
                  react::Element<react::ViewShadowNode>().tag(6).props([] { return tall(30); }),
                  react::Element<react::ViewShadowNode>().tag(7).props([] { return tall(30); }),
              }),
          });

  // Kept: the families' descriptors live in its registry.
  auto components = builder();

  components.build(element);
  root->layoutIfNeeded();

  // No report yet: the content box.
  printFixed("before", *root);
  printSized("before", *root);

  // A 40 pt native header above the slot, in each card.
  root = reported(root, 0, {1, {0, 40, 0, 0}});
  printFixed("header", *root);
  root = reported(root, 1, {1, {0, 40, 0, 0}});
  printSized("header", *root);

  // Within a pixel of what the card holds: nothing to lay out again.
  root = reported(root, 0, {2, {0, 40.2f, 0, 0}});

  // A native effect grows the header: the slot shrinks and moves down.
  root = reported(root, 0, {3, {0, 64, 0, 0}});
  printFixed("grown", *root);

  // Right to left: an inset from the left edge stays on the left.
  const auto& fixed = cardOf(*root, 0);

  root = relayout(*root, fixed.getFamily(), [](const react::ShadowNode& old) {
    return old.clone({.props = cardProps(150, yoga::Direction::RTL), .children = nullptr, .state = nullptr});
  });
  root = reported(root, 0, {4, {8, 0, 0, 0}, true});
  printFixed("rtl", *root);

  // The slot fills the content box again.
  root = reported(root, 0, {5, {}, true});
  printFixed("filled", *root);

  return 0;
}
