import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress } from "viem";
import hre from "hardhat";

import {
  deployMarketplaceFixture,
  designatedAdminFixture,
  listedArtworkFixture,
} from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("8. Pause Functionality (`pause`, `unpause`)", function () {
  const { ONE_ETHER, TWO_ETHER } = TEST_CONSTANTS.PRICES;
  const { TEST_2: TEST_URI_2 } = TEST_CONSTANTS.URI;
  const { SAMPLE_ROYALTY_FEE_BPS } = TEST_CONSTANTS.FEES;

  it("8.1 should allow owner to pause and unpause", async function () {
    const { artGallery, owner, publicClient } = await loadFixture(
      deployMarketplaceFixture,
    );
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );

    // Pause
    const pauseTx = await artGalleryAsOwner.write.pause();
    await publicClient.waitForTransactionReceipt({ hash: pauseTx });
    expect(await artGallery.read.paused()).to.be.true;

    // Unpause
    const unpauseTx = await artGalleryAsOwner.write.unpause();
    await publicClient.waitForTransactionReceipt({ hash: unpauseTx });
    expect(await artGallery.read.paused()).to.be.false;
  });

  it("8.2 should NOT allow non-owner to pause or unpause", async function () {
    const { artGallery, designatedAdmin, otherAccount } = await loadFixture(
      designatedAdminFixture,
    ); // Use fixture where designatedAdmin is admin but not owner
    const artGalleryAsAdmin = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: designatedAdmin } },
    );
    const artGalleryAsOther = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: otherAccount } },
    );

    // Admin tries
    await expect(artGalleryAsAdmin.write.pause()).to.be.rejectedWith(
      "OwnableUnauthorizedAccount",
    );
    await expect(artGalleryAsAdmin.write.unpause()).to.be.rejectedWith(
      "OwnableUnauthorizedAccount",
    );

    // Other user tries
    await expect(artGalleryAsOther.write.pause()).to.be.rejectedWith(
      "OwnableUnauthorizedAccount",
    );
    await expect(artGalleryAsOther.write.unpause()).to.be.rejectedWith(
      "OwnableUnauthorizedAccount",
    );
  });

  it("8.3 should prevent state-changing actions when paused", async function () {
    const {
      artGallery,
      owner,
      artist1,
      designatedAdmin,
      buyer1,
      publicClient,
      tokenId,
    } = await loadFixture(listedArtworkFixture).then(
      async (listedData) => ({
        ...listedData,
        ...(await loadFixture(designatedAdminFixture)),
      }), // Combine fixtures
    );

    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );
    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );
    const artGalleryAsBuyer = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: buyer1 } },
    );

    // Pause the contract
    const pauseTx = await artGalleryAsOwner.write.pause();
    await publicClient.waitForTransactionReceipt({ hash: pauseTx });
    expect(await artGallery.read.paused()).to.be.true;

    // Test actions affected by whenNotPaused
    await expect(
      artGalleryAsArtist.write.listArtwork([TEST_URI_2, ONE_ETHER]),
    ).to.be.rejectedWith("EnforcedPause()");
    await expect(
      artGalleryAsBuyer.write.buyArtwork([tokenId], { value: ONE_ETHER }),
    ).to.be.rejectedWith("EnforcedPause()");
    await expect(
      artGalleryAsOwner.write.updatePrice([tokenId, TWO_ETHER]),
    ).to.be.rejectedWith("EnforcedPause()");
    await expect(
      artGalleryAsOwner.write.delistArtwork([tokenId]),
    ).to.be.rejectedWith("EnforcedPause()");
    await expect(
      artGalleryAsOwner.write.setAdmin([
        getAddress(designatedAdmin.account.address),
        true,
      ]),
    ).to.be.rejectedWith("EnforcedPause()");
    await expect(
      artGalleryAsOwner.write.setRoyaltyFee([SAMPLE_ROYALTY_FEE_BPS]),
    ).to.be.rejectedWith("EnforcedPause()");

    // Unpause and verify one action works again
    const unpauseTx = await artGalleryAsOwner.write.unpause();
    await publicClient.waitForTransactionReceipt({ hash: unpauseTx });
    expect(await artGallery.read.paused()).to.be.false;

    // Example: setRoyaltyFee should work now
    await expect(
      artGalleryAsOwner.write.setRoyaltyFee([SAMPLE_ROYALTY_FEE_BPS]),
    ).to.not.be.rejected;
  });
});
