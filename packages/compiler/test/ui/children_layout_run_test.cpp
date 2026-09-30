// The fixture's Card, which takes React children, laid out by React
// Native's renderer (its Yoga integration, as the prebuilt framework has
// it): a Yoga container, sized by its padding, border and children as a
// View is, its children at Yoga's frames in its own coordinates, and its
// state never asking its host for a measurement. Prints one line per step;
// children-layout-run.test.ts checks them.
#include <views/CARD.h>

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/element/ComponentBuilder.h>
#include <react/renderer/element/Element.h>

#include <cstdio>
#include <memory>
#include <string>

namespace card = lucent::views::CARD;
namespace react = facebook::react;
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

std::string frame(const react::ShadowNode& node) {
  auto f = static_cast<const react::LayoutableShadowNode&>(node).getLayoutMetrics().frame;
  char out[64];

  std::snprintf(out, sizeof out, "%g,%g %gx%g", f.origin.x, f.origin.y, f.size.width, f.size.height);

  return out;
}

/** A View of `height`, stretched across its parent. */
std::shared_ptr<react::ViewProps> tall(float height) {
  auto props = std::make_shared<react::ViewProps>();

  props->yogaStyle.setDimension(yoga::Dimension::Height, yoga::StyleSizeLength::points(height));

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
            props->yogaStyle.setDimension(yoga::Dimension::Width, yoga::StyleSizeLength::points(300));
            props->yogaStyle.setDimension(yoga::Dimension::Height, yoga::StyleSizeLength::points(500));
            // The card at its content's height, not stretched down the column.
            props->yogaStyle.setAlignItems(yoga::Align::FlexStart);

            return props;
          })
          .children({
              react::Element<card::ShadowNode>()
                  .tag(2)
                  .props([] {
                    auto props = std::make_shared<card::Props>();

                    props->yogaStyle.setDimension(yoga::Dimension::Width, yoga::StyleSizeLength::points(200));
                    props->yogaStyle.setPadding(yoga::Edge::All, yoga::StyleLength::points(10));
                    props->yogaStyle.setBorder(yoga::Edge::All, yoga::StyleLength::points(2));

                    return props;
                  })
                  .children({
                      react::Element<react::ViewShadowNode>().tag(3).props([] { return tall(30); }),
                      react::Element<react::ViewShadowNode>().tag(4).props([] { return tall(20); }),
                  }),
          });

  // Kept: the families' descriptors live in its registry.
  auto components = builder();

  components.build(element);
  root->layoutIfNeeded();

  const auto& laidOut = *root->getChildren().at(0);
  const auto& traits = laidOut.getTraits();

  std::printf("card: %s\n", frame(laidOut).c_str());
  std::printf("first child: %s\n", frame(*laidOut.getChildren().at(0)).c_str());
  std::printf("second child: %s\n", frame(*laidOut.getChildren().at(1)).c_str());
  std::printf(
      "leaf: %s, measurable: %s\n",
      traits.check(react::ShadowNodeTraits::Trait::LeafYogaNode) ? "yes" : "no",
      traits.check(react::ShadowNodeTraits::Trait::MeasurableYogaNode) ? "yes" : "no");
  std::printf(
      "asks its host: %s\n",
      static_cast<const card::ShadowNode&>(laidOut).getStateData().requested ? "yes" : "no");

  return 0;
}
