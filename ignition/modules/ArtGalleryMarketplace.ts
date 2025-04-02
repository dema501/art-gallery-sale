import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ArtGalleryMarketplaceModule = buildModule(
  "ArtGalleryMarketplace",
  (m) => {
    const artGalleryMarketplace = m.contract("ArtGalleryMarketplace", []);

    return { artGalleryMarketplace };
  },
);

export default ArtGalleryMarketplaceModule;
