import e from "../validator.ts";
import { Mongo, ObjectId } from "../mod.ts";
import { inspect } from "node:util";

Deno.test({
  name: "Push to a deep array",
  async fn(t) {
    const UserSchema = e.object({
      invoices: e.array(e.object({
        currency: e.in(["lyd", "usd"]).checkpoint(),
        items: e.array(e.object({
          _id: e.optional(e.instanceOf(ObjectId, { instantiate: true }))
            .default(() => new ObjectId()),
          amount: e.number(),
        })),
      })),
      timeline: e.array(e.object({
        user: e.instanceOf(ObjectId, { instantiate: true }),
      })),
    });

    const UserModel = Mongo.model("user", UserSchema, 0);

    Mongo.enableLogs = true;

    await Mongo.connect(`mongodb://localhost:27017/mongo-1`);

    await Mongo.dropAll();

    await t.step("Create Users and Posts", async () => {
      const { modifications } = await UserModel.updateOne({}, {
        $push: {
          "invoices.$[invoice1].items": {
            $each: [{
              amount: 1,
            }],
          },
          timeline: {
            user: new ObjectId(),
          },
        },
      }, {
        arrayFilters: [{
          "invoice1.currency": "lyd",
        }],
      }).catch((err) => {
        console.error(inspect(err, false, Infinity, true));
        throw err;
      });

      console.log(
        "PushToDeepArray Modifications:",
        inspect(modifications, false, Infinity, true),
      );

      if (
        // deno-lint-ignore no-explicit-any
        !(modifications.invoices["$[invoice1]" as any].items[0]._id instanceof
          ObjectId)
      ) {
        throw new Error("A default value was not generated!");
      }
    });

    await Mongo.disconnect();
  },
  sanitizeResources: true,
  sanitizeOps: true,
});
