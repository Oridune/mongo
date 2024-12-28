import e from "../validator.ts";
import { Mongo, ObjectId } from "../mod.ts";

const UserSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
  username: e.string(),
  password: e.string(),
  posts: e.array(e.instanceOf(ObjectId, { instantiate: true })),
  timeline: e.array(e.object({
    user: e.instanceOf(ObjectId, { instantiate: true }),
  })),
});

const UserModel = Mongo.model("user", UserSchema, 0);

const PostSchema = e.object({
  _id: e.optional(e.instanceOf(ObjectId, { instantiate: true })),
  title: e.string(),
});

const PostModel = Mongo.model("post", PostSchema, 1);

const CheckSchema = e.object({
  _id: e.instanceOf(ObjectId, { instantiate: true }),
  posts: e.array(PostSchema),
  timeline: e.array(e.object({
    user: e.object({
      _id: e.instanceOf(ObjectId, { instantiate: true }),
      username: e.string(),
    }),
  })),
}).extends(e.omit(UserSchema, ["_id", "posts", "timeline"]));

Deno.test({
  name: "Fetch relationships from other connections",
  async fn(t) {
    Mongo.enableLogs = true;

    await Mongo.connect(
      `
      mongodb://localhost:27017/mongo-1,
      mongodb://localhost:27017/mongo-2
      `,
    );

    await Mongo.dropAll();

    await t.step("Create Users and Posts", async () => {
      const [post1, post2] = await PostModel.createMany([{
        title: "post 1",
      }, {
        title: "post 2",
      }]);

      const user1 = await UserModel.create({
        username: "saif",
        password: "saif",
        posts: [post1._id],
        timeline: [],
      });

      const user2 = await UserModel.create({
        username: "john",
        password: "john",
        posts: [],
        timeline: [{
          user: user1._id,
        }],
      });

      const _user3 = await UserModel.create({
        username: "jean",
        password: "jean",
        posts: [post1._id, post2._id],
        timeline: [{
          user: user1._id,
        }, {
          user: user2._id,
        }],
      });

      const Results = await UserModel.find()
        .fetch("posts", PostModel)
        .fetchOne("timeline.user", UserModel, { project: { username: 1 } });

      await e.array(CheckSchema).validate(Results);
    });

    await Mongo.disconnect();
  },
  // sanitizeResources: false,
  // sanitizeOps: false,
});
