import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { parseEther } from "viem";
import hre from "hardhat";

import { deployMarketplaceFixture } from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("10. MaxPrice Management", function () {
  const { ONE_ETHER } = TEST_CONSTANTS.PRICES;

  it("10.1 should initialize with correct default max price", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    expect(await artGallery.read.maxPrice()).to.equal(parseEther("1000"));
  });

  it("10.2 should allow admin to update max price", async function () {
    const { artGallery, owner, publicClient } = await loadFixture(
      deployMarketplaceFixture,
    );
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    const newMaxPrice = parseEther("2000");
    const tx = await artGalleryAsOwner.write.setMaxPrice([newMaxPrice]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    expect(await artGallery.read.maxPrice()).to.equal(newMaxPrice);

    const events = await artGallery.getEvents.MaxPriceUpdated();
    expect(events[events.length - 1].args.newMaxPrice).to.equal(newMaxPrice);
  });

  it("10.3 should NOT allow non-admin to update max price", async function () {
    const { artGallery, otherAccount } = await loadFixture(
      deployMarketplaceFixture,
    );
    const artGalleryAsOther = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: otherAccount } },
    );

    await expect(
      artGalleryAsOther.write.setMaxPrice([parseEther("2000")]),
    ).to.be.rejectedWith("ArtGalleryMarketplace__NotAdmin");
  });
});
