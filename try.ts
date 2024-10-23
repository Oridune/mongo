import { ObjectId } from "./deps.ts";
import { Mongo } from "./mod.ts";
import e from "./validator.ts";

await Mongo.connect(
  `
  mongodb://localhost:27017/mongo-1,
  mongodb://localhost:27017/mongo-2
  `,
);

await Mongo.dropAll();

const UserSchema = e.object({
  username: e.string(),
  password: e.string(),
  posts: e.array(e.instanceOf(ObjectId, { instantiate: true })),
});

const UserModel = Mongo.model("user", UserSchema, 0);

const PostSchema = e.object({
  title: e.string(),
});

const PostModel = Mongo.model("post", PostSchema, 1);

const post = await PostModel.create({
  title: "test",
});

await UserModel.create({
  username: "saif",
  password: "saif",
  posts: [post._id],
});

console.log("It starts here!");

console.log(await UserModel.find().fetchOne("posts", PostModel));

await Mongo.disconnect();
