import e, { type inferInput, type inferOutput } from "../validator.ts";
import {
    type InputDocument,
    Mongo,
    ObjectId,
    type OutputDocument,
} from "../mod.ts";
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";

export enum WarehouseInventoryStatus {
    PENDING = "pending",
    APPROVED = "approved",
    REJECTED = "rejected",
}

export const InputShelfReferencesSchema = e.object({
    _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
    shelfId: e.string(),
    quantity: e.number(),
});

export const InputWarehouseShelfReferencesSchema = e
    .object({
        createdAt: e.optional(e.date()).default(() => new Date()),
        updatedAt: e.optional(e.date()).default(() => new Date()),
        createdBy: e.instanceOf(ObjectId, { instantiate: true }),
        updatedBy: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
    })
    .extends(InputShelfReferencesSchema);

export const InputWarehouseInventorySchema = e.object({
    warehouse: e.instanceOf(ObjectId, { instantiate: true }),
    product: e.instanceOf(ObjectId, { instantiate: true }),
    variant: e.instanceOf(ObjectId, { instantiate: true }),
    initialQuantity: e.number(),
    reference: e.optional(e.string()),
});

export const WarehouseInventorySchema = e
    .object({
        _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
        account: e.instanceOf(ObjectId, { instantiate: true }),
        createdAt: e.optional(e.date()).default(() => new Date()),
        updatedAt: e.optional(e.date()).default(() => new Date()),
        createdBy: e.instanceOf(ObjectId, { instantiate: true }),
        lockedQuantity: e.optional(e.number()),
        quantity: e.optional(e.number()),
        status: e
            .optional(e.in(Object.values(WarehouseInventoryStatus)))
            .default(WarehouseInventoryStatus.PENDING),
        shelfReferences: e.optional(
            e.array(InputWarehouseShelfReferencesSchema),
        ),
        updatedBy: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
    })
    .extends(InputWarehouseInventorySchema);

export type TWarehouseInventoryInput = InputDocument<
    inferInput<typeof WarehouseInventorySchema>
>;
export type TWarehouseInventoryOutput = OutputDocument<
    inferOutput<typeof WarehouseInventorySchema>
>;

export const WarehouseInventoryModel = Mongo.model(
    "warehouseInventory",
    WarehouseInventorySchema,
);

WarehouseInventoryModel.pre("update", (details) => {
    details.updates.$set = {
        ...details.updates.$set,
        updatedAt: new Date(),
    };

    console.log("Updates:", details.updates);
});

Deno.test({
    name: "Array filter tests",
    async fn(t) {
        Mongo.enableLogs = true;

        const ConnectionString =
            "mongodb://localhost:27017/mongo,mongodb://localhost:27017/mongo-1";

        await Mongo.connect(ConnectionString);
        await Mongo.drop(1);

        await t.step(
            "Add shelf references to a warehouse inventory",
            async () => {
                type TShelfValue = string | number | ObjectId | Date;

                interface IUpdateFields {
                    [key: string]: TShelfValue;
                }

                const updateFields: IUpdateFields = {};
                const arrayFilters: Array<Record<string, ObjectId>> = [];

                const data = [{
                    _id: new ObjectId(),
                    shelfId: "1",
                    quantity: 30,
                }, {
                    _id: new ObjectId(),
                    shelfId: "2",
                    quantity: 20,
                }, {
                    _id: new ObjectId(),
                    shelfId: "3",
                    quantity: 10,
                }];

                data.forEach((shelf, index) => {
                    Object.keys(shelf).forEach((key) => {
                        if (key !== "_id") {
                            updateFields[
                                `shelfReferences.$[elem${index}].${key}`
                            ] = shelf[
                                key as keyof typeof shelf
                            ] as TShelfValue;
                        }
                    });

                    updateFields[`shelfReferences.$[elem${index}].updatedBy`] =
                        new ObjectId();

                    updateFields[`shelfReferences.$[elem${index}].updatedAt`] =
                        new Date();

                    arrayFilters.push({
                        [`elem${index}._id`]: shelf?._id as ObjectId,
                    });
                });

                const query = {
                    _id: new ObjectId(),
                };

                const { modifications } = await WarehouseInventoryModel
                    .updateOne(
                        query,
                        { $set: updateFields },
                        {
                            arrayFilters,
                        },
                    );

                assertEquals(
                    Object.values(modifications.shelfReferences!).map((
                        item,
                    ) => ({
                        shelfId: item.shelfId,
                        quantity: item.quantity,
                    })),
                    data.map((item) => ({
                        shelfId: item.shelfId,
                        quantity: item.quantity,
                    })),
                );
            },
        );

        await Mongo.disconnect();
    },
    sanitizeResources: false,
    sanitizeOps: false,
});
