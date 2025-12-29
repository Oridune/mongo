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
  name: e.string(),
  post: e.instanceOf(ObjectId, { instantiate: true }),
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

const PostSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
  title: e.string(),
  comment: e.instanceOf(ObjectId, { instantiate: true }),
  review: e.instanceOf(ObjectId, { instantiate: true }),
});

const PostModel = Mongo.model("post", PostSchema, 0);

const CommentSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
  content: e.string(),
});

const CommentModel = Mongo.model("comment", CommentSchema, 0);

const ReviewSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
  rating: e.number(),
});

const ReviewModel = Mongo.model("review", ReviewSchema, 0);

const comment = await CommentModel.create({
  content: "This is a comment",
});

const review = await ReviewModel.create({
  rating: 5,
});

const post = await PostModel.create({
  title: "This is a post",
  comment: comment._id,
  review: review._id,
});

await UserModel.create({
  name: "John Doe",
  post: post._id,
});

console.log(
  await UserModel.find({})
    .populateOne(
      "post",
      PostModel
        .populateOne("comment", CommentModel)
        .populateOne("review", ReviewModel),
    ),
);

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

// const C = await UserModel.count().groupBy("users");
// console.log("Count:", C);

await Mongo.disconnect();
