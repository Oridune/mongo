import { inspect } from "node:util";
import { ObjectId } from "./deps.ts";
import { Mongo } from "./mod.ts";
import e from "./validator.ts";

Mongo.enableLogs = true;

await Mongo.connect(
  `
  mongodb://localhost:27017/mongo-1
  `,
);

await Mongo.dropAll();

const UserSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
  // invoices: e.array(e.object({
  //   currency: e.in(["lyd", "usd"]).checkpoint(),
  //   items: e.array(e.object({
  //     amount: e.number(),
  //   })),
  // })),
  // timeline: e.array(e.object({
  //   user: e.instanceOf(ObjectId, { instantiate: true }),
  // })),
});

const UserModel = Mongo.model("user", UserSchema, 0);

await UserModel.create({});

// await UserModel.updateOne({}, {
//   $push: {
//     "invoices.$[invoice1].items": {
//       $each: [{
//         amount: 1,
//       }],
//     },
//     timeline: {
//       user: new ObjectId(),
//     },
//   },
// }, {
//   arrayFilters: [{
//     "invoice1.currency": "lyd",
//   }],
// }).catch((err) => console.error(inspect(err, false, Infinity, true)));

const C = await UserModel.count().groupBy("users");
console.log("Count:", C);

await Mongo.disconnect();
